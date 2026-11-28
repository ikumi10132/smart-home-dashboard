import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
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

    // ---------- スケジュールの保存先 (DynamoDB) ----------
    // 件数が少なく読み書きも 1 分に 1 回程度なので、無料枠 (25 ユニット) の中で 1 ユニットずつ確保する。
    // 利用者が作ったデータなので、スタックを消してもテーブルは残す (RETAIN)
    const scheduleTable = new dynamodb.Table(this, 'Schedules', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---------- API (API Gateway + Lambda) ----------
    const lambdaDefaults = {
      projectRoot: root,
      depsLockFilePath: path.join(root, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      environment: { PARAM_PREFIX, SCHEDULE_TABLE: scheduleTable.tableName, NODE_OPTIONS: '--enable-source-maps' },
      // Lambda 標準の SDK は版が古いことがあるので、使う SDK も一緒にまとめる
      bundling: { minify: true, sourceMap: true, externalModules: [] },
    } satisfies Partial<nodejs.NodejsFunctionProps>;
    const tokenPolicy = new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${PARAM_PREFIX}/*`],
    });

    const fn = new nodejs.NodejsFunction(this, 'ApiFunction', {
      ...lambdaDefaults,
      entry: path.join(root, 'api/src/handler.ts'),
      // スケジュールの「今すぐ実行」で操作を順に送るため長め (API Gateway の上限 30 秒より短く)
      timeout: cdk.Duration.seconds(28),
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    fn.addToRolePolicy(tokenPolicy);
    scheduleTable.grantReadWriteData(fn);

    // ---------- スケジューラー (EventBridge で 1 分ごとに Lambda を起動) ----------
    // 月 約 4.3 万回の起動で、Lambda の無料枠 (月 100 万回) に収まる。時刻が来ていなければ外部 API は呼ばない
    const schedulerFn = new nodejs.NodejsFunction(this, 'SchedulerFunction', {
      ...lambdaDefaults,
      entry: path.join(root, 'api/src/scheduler.ts'),
      timeout: cdk.Duration.seconds(55),
      logGroup: new logs.LogGroup(this, 'SchedulerLogs', {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });
    schedulerFn.addToRolePolicy(tokenPolicy);
    scheduleTable.grantReadWriteData(schedulerFn);
    new events.Rule(this, 'SchedulerTick', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new targets.LambdaFunction(schedulerFn, { retryAttempts: 0 })],
    });

    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${wssoPoolId}`,
      { jwtAudience: [wssoClientId] },
    );
    const api = new apigw.HttpApi(this, 'HttpApi', {
      defaultAuthorizer: authorizer,
      corsPreflight: {
        allowOrigins: [siteUrl, LOCAL_DEV_URL],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.PUT, apigw.CorsHttpMethod.DELETE],
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
    api.addRoutes({ path: '/schedules', methods: [apigw.HttpMethod.GET, apigw.HttpMethod.POST], integration });
    api.addRoutes({ path: '/schedules/{id}', methods: [apigw.HttpMethod.PUT, apigw.HttpMethod.DELETE], integration });
    api.addRoutes({ path: '/schedules/{id}/run', methods: [apigw.HttpMethod.POST], integration });
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
