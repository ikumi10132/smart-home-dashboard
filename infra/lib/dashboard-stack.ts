import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PARAM_PREFIX = '/smart-home-dashboard';
const LOCAL_DEV_URL = 'http://localhost:5173';

export class DashboardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------- 画面 (S3 + CloudFront) ----------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      defaultRootObject: 'index.html',
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
      })),
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // 日本を含む
    });
    const siteUrl = `https://${distribution.distributionDomainName}`;

    // ---------- ログイン: W-SSO (wakalabo 共通ログイン。wakalabo-apps が SSM に置いた値を読む) ----------
    // 以前のおうちダッシュボード専用のユーザープールは、スタックから外しても AWS 上には残る (RETAIN)。
    // 中身はログイン用のユーザーだけなので、不要になったら Cognito のコンソールから削除してよい
    const wssoPoolId = ssm.StringParameter.valueForStringParameter(this, '/wakalabo/auth/user-pool-id');
    const wssoClientId = ssm.StringParameter.valueForStringParameter(this, '/wakalabo/auth/wsso-client-id');
    const ssoUrl = ssm.StringParameter.valueForStringParameter(this, '/wakalabo/auth/sso-url');

    // ---------- API (API Gateway + Lambda) ----------
    const fn = new nodejs.NodejsFunction(this, 'ApiFunction', {
      entry: path.join(root, 'api/src/handler.ts'),
      projectRoot: root,
      depsLockFilePath: path.join(root, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      environment: { PARAM_PREFIX, NODE_OPTIONS: '--enable-source-maps' },
      // Lambda 標準の SDK は版が古いことがあるので、使う SDK も一緒にまとめる
      bundling: { minify: true, sourceMap: true, externalModules: [] },
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${PARAM_PREFIX}/*`],
      }),
    );

    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${wssoPoolId}`,
      { jwtAudience: [wssoClientId] },
    );
    const api = new apigw.HttpApi(this, 'HttpApi', {
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: [siteUrl, LOCAL_DEV_URL],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: cdk.Duration.hours(1),
      },
    });
    const integration = new HttpLambdaIntegration('ApiIntegration', fn);
    api.addRoutes({ path: '/devices', methods: [apigw.HttpMethod.GET], integration });
    api.addRoutes({
      path: '/devices/{id}/command',
      methods: [apigw.HttpMethod.POST],
      integration,
    });
    const stage = api.defaultStage?.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingBurstLimit: 20, throttlingRateLimit: 10 };

    // ---------- MyTask! (タスク管理) との連携 ----------
    // 画面からブラウザで MyTask! の API を直接呼ぶ (今日のタスクの表示・電池交換のタスクの作成)。
    // ここでは MyTask! が SSM に置いた URL を読むだけで、AWS のリソースは増やさない。
    // MyTask! を先にデプロイしておく必要がある。連携しないときは cdk.json の context で "mytask": false
    const mytaskEnabled = this.node.tryGetContext('mytask') !== false && this.node.tryGetContext('mytask') !== 'false';
    const mytask = mytaskEnabled
      ? {
          mytaskApiUrl: ssm.StringParameter.valueForStringParameter(this, '/wakalabo/mytask/api-url'),
          mytaskSiteUrl: ssm.StringParameter.valueForStringParameter(this, '/wakalabo/mytask/site-url'),
        }
      : {};

    // ---------- 画面のデプロイ ----------
    new s3deploy.BucketDeployment(this, 'DeployWeb', {
      sources: [
        s3deploy.Source.asset(path.join(root, 'web/dist')),
        s3deploy.Source.jsonData('config.json', {
          apiUrl: api.apiEndpoint,
          ssoUrl,
          wssoClientId,
          region: this.region,
          ...mytask,
        }),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
  }
}
