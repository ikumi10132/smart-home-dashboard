import * as cdk from 'aws-cdk-lib';
import { DashboardStack } from '../lib/dashboard-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-southeast-2',
};

// 本体: ダッシュボード画面・API・ログイン
new DashboardStack(app, 'SmartHomeDashboard', { env });

// GitHub Actions から AWS にデプロイするための IAM ロール (最初に1回だけ手動デプロイ)
new GithubOidcStack(app, 'SmartHomeDashboardGithubOidc', {
  env,
  repo: app.node.getContext('githubRepo') as string,
});
