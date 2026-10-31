# おうちダッシュボード

SwitchBot と Nature Remo の家電を、自作の Web ダッシュボードから操作するためのプロジェクトです。
自宅に常時稼働の機器を置かず、各メーカーのクラウド API を AWS 経由で呼び出します。
Apple Home (HomePod) とは別ルートで動くので、Siri やホームアプリはそのまま使えます。

```
[スマホ/PC] ─▶ CloudFront + S3 (React の画面)
     │
     └─▶ API Gateway (Cognito でログイン必須) ─▶ Lambda ─┬─▶ SwitchBot API
                                                       └─▶ Nature Remo API
GitHub (main に push) ─▶ GitHub Actions ─▶ AWS CDK でデプロイ
```

| ディレクトリ | 内容 |
|---|---|
| `api/` | Lambda (TypeScript)。SwitchBot / Nature Remo のデータを共通形式に変換 |
| `web/` | ダッシュボード画面 (React + Vite) |
| `infra/` | AWS CDK。S3 / CloudFront / Cognito / API Gateway / Lambda |

## 対応している機器

- **SwitchBot**: プラグ、照明、カーテン、ボット、温湿度計 / ハブ2、赤外線リモコン (エアコン・テレビ・照明・その他)
- **Nature Remo**: エアコン、照明、テレビ、登録したリモコンボタン、温湿度 (センサー搭載機種のみ)
- **IKEA (DIRIGERA)**: クラウド API がないため対象外

## セットアップ

前提: Node.js 22 以上、AWS CLI v2 (`aws login` でログイン済み)

```bash
npm ci
```

### 1. API トークンを AWS に保存する

トークンはコードや GitHub に置かず、SSM パラメータストア (SecureString、無料) に保存します。
使わないサービスの分は登録しなくても動きます。

- Nature Remo: https://home.nature.global でアクセストークンを発行
- SwitchBot: アプリの「プロフィール → 設定 → アプリバージョンを10回タップ → 開発者向けオプション」

```bash
aws ssm put-parameter --type SecureString --name /smart-home-dashboard/remo/token --value 'Remoのトークン'
aws ssm put-parameter --type SecureString --name /smart-home-dashboard/switchbot/token --value 'SwitchBotのトークン'
aws ssm put-parameter --type SecureString --name /smart-home-dashboard/switchbot/secret --value 'SwitchBotのシークレット'
```

### 2. 初回デプロイ

```bash
cd infra
npx cdk bootstrap   # AWS アカウント・リージョンごとに初回のみ
cd ..
npm run deploy
```

完了すると `SiteUrl` (画面の URL) や `UserPoolId` が表示されます。
既定のリージョンは `ap-southeast-2` です。変えるときは `CDK_DEFAULT_REGION` を設定してください。

### 3. ログインユーザーを作る

新規登録は無効にしてあるので、自分のユーザーを CLI で作成します。

```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> --username you@example.com \
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true
```

仮パスワードがメールで届くので、`SiteUrl` を開いてログインし、新しいパスワードを設定します。
iPhone では Safari の共有メニューから「ホーム画面に追加」すると、アプリのように使えます。

### 4. GitHub Actions で自動デプロイする

1. `infra/cdk.json` の `githubRepo` を自分のリポジトリ (`owner/repo`) に合わせる
2. デプロイ用の IAM ロールを作る (初回のみ):
   ```bash
   cd infra && npx cdk deploy SmartHomeDashboardGithubOidc
   ```
   アカウントに GitHub の OIDC プロバイダーがすでにある場合は失敗するので、そのときは相談してください。
3. 出力された `DeployRoleArn` を、GitHub のリポジトリ設定 → Secrets and variables → Actions → **Variables** に
   `AWS_DEPLOY_ROLE_ARN` として登録 (リージョンを変える場合は `AWS_REGION` も)

以降は `main` に push すると、型チェック・テスト・ビルドのあと自動でデプロイされます。

## ローカル開発

デプロイ後の出力値を使って `web/public/config.json` を作ります (`config.example.json` を参照)。

```bash
npm run dev   # http://localhost:5173
```

API は AWS 上のものを使います (Cognito と CORS で localhost:5173 を許可済み)。

## API の回数制限

- Nature Remo: 5 分で 30 回まで
- SwitchBot: 1 日 10,000 回まで

Lambda 側で一覧を 1 分 (SwitchBot の機器リストは 10 分) キャッシュし、画面の自動更新も 2 分ごと・表示中のみにしています。

## 費用の目安

個人利用ならほぼ無料枠内です (CloudFront / Lambda / API Gateway / Cognito / SSM)。
CloudWatch Logs は 1 か月で自動削除されます。
