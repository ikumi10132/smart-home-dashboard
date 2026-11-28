# おうちダッシュボード

SwitchBot と Nature Remo の家電を、自作の Web ダッシュボードから操作するためのプロジェクトです。
自宅に常時稼働の機器を置かず、各メーカーのクラウド API を AWS 経由で呼び出します。
Apple Home (HomePod) とは別ルートで動くので、Siri やホームアプリはそのまま使えます。

```
[スマホ/PC] ─▶ CloudFront + S3 (React の画面)
     │
     └─▶ API Gateway (W-SSO でログイン必須) ─▶ Lambda ─┬─▶ SwitchBot API
                                                       ├─▶ Nature Remo API
                                                       └─▶ DynamoDB (スケジュール)
EventBridge (1 分ごと) ─▶ スケジューラー Lambda ─▶ 時刻が来たスケジュールの操作を送る
GitHub (main に push) ─▶ GitHub Actions で型チェック・テスト
AWS CloudShell ─▶ AWS CDK でデプロイ
```

| ディレクトリ | 内容 |
|---|---|
| `api/` | Lambda (TypeScript)。SwitchBot / Nature Remo のデータを共通形式に変換 |
| `web/` | ダッシュボード画面 (React + Vite) |
| `infra/` | AWS CDK。S3 / CloudFront / API Gateway / Lambda / DynamoDB / EventBridge |

## 対応している機器

- **SwitchBot**: プラグ、照明、カーテン、ボット、温湿度計 / ハブ2、赤外線リモコン (エアコン・テレビ・照明・その他)
- **Nature Remo**: エアコン、照明、テレビ、登録したリモコンボタン、温湿度 (センサー搭載機種のみ)
- **IKEA (DIRIGERA)**: クラウド API がないため対象外

## スケジュール

画面の「スケジュール」で、曜日と時刻 (日本時間) を決めて家電をまとめて操作できます。

- 1 つのスケジュールに操作を 10 個まで入れられます (例: 平日 6:45 に「エアコンを暖房 22℃で運転」→「カーテンを開ける」)。上から順に送ります
- 「今すぐ実行」で試しに動かせます。有効 / 無効はスイッチで切り替えます
- スケジューラーは 1 分ごとに動き、起動が遅れても 5 分以内なら取り戻して実行します。同じ回を二度実行することはありません
- 時刻を過ぎてから保存したスケジュールは、その日の回は実行しません (保存した直後に急に動かないように)
- 結果は「前回 … 成功 / 失敗」として表示されます。詳しいログは CloudWatch Logs の SchedulerFunction のロググループにあります
- 費用: Lambda は月 約 4.3 万回の起動 (無料枠 100 万回)。DynamoDB は読み書き 1 ユニットずつ (無料枠 25 ユニット) なので、無料枠に収まります
- スケジュールのテーブルは、スタックを削除しても残ります (RETAIN)。不要になったら DynamoDB のコンソールから削除してください

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

完了すると `SiteUrl` (画面の URL) が表示されます。
既定のリージョンは `ap-southeast-2` です。変えるときは `CDK_DEFAULT_REGION` を設定してください。

### 3. ログイン (W-SSO)

ログインは **W-SSO** (wakalabo 共通ログイン。ログイン画面は https://apps.wakalabo.net/sso.html) を使います。
使う人の追加と、おうちダッシュボードを使えるかどうか (グループ `app-smart-home`。admin は全部使える) の設定は、
ダッシュボード (apps.wakalabo.net) の「ユーザー管理」で行います。
W-SSO の情報は wakalabo-apps が SSM パラメータ (`/wakalabo/auth/...`) に置いたものを読むので、**wakalabo-apps を先にデプロイ**しておく必要があります。

iPhone では Safari の共有メニューから「ホーム画面に追加」すると、アプリのように使えます。

### 4. 更新したコードをデプロイする (CloudShell)

この AWS アカウント (新しい AWS エクスペリエンス) は、AWS が管理する制限 (SCP) で GitHub との OIDC 連携が禁止されているため、
GitHub Actions からはデプロイできません。AWS コンソールの CloudShell に次を貼り付けてデプロイします。

```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null \
  && cd /tmp && rm -rf smart-home-dashboard && git clone --depth 1 https://github.com/ikumi10132/smart-home-dashboard.git && cd smart-home-dashboard \
  && npm ci && npm run build && cd infra && npx cdk deploy SmartHomeDashboard --require-approval never
```

(`nvm: command not found` と出たら、先に `curl -so- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && source ~/.nvm/nvm.sh && nvm install 22`)

## MyTask! (タスク管理) との連携

[MyTask!](https://github.com/ikumi10132/mytask) を使っている人がログインすると、ダッシュボードに次のものが出ます。

- **今日のタスク**: 期限・「知らせる日」・目安を過ぎた家事 (MyTask! の「前回から何日」)
- **電池交換のタスク**: 電池残量が 20% 以下の機器があると、MyTask! に「〇〇の電池交換」を自動で作ります (同じ機器のタスクが終わるまでは二重に作りません)

画面 (ブラウザ) から、同じ W-SSO のログインのまま MyTask! の API を直接呼ぶので、このダッシュボードの AWS 側には何も増えません。
電池の確認はダッシュボードを開いているときだけ動きます (少ない機器の組み合わせが変わったときだけ送ります)。

- MyTask! の API の URL は、MyTask! が SSM (`/wakalabo/mytask/api-url`・`site-url`) に置いたものをデプロイのときに読みます。**MyTask! を先にデプロイ**してください
- MyTask! を使えない人 (グループ `app-mytask` に入っていない) には、今日のタスクは出ません
- 連携しないときは `infra/cdk.json` の context を `"mytask": false` にしてデプロイします

## ローカル開発

デプロイ後の出力値を使って `web/public/config.json` を作ります (`config.example.json` を参照)。

```bash
npm run dev   # http://localhost:5173
```

API は AWS 上のものを使います (CORS で localhost:5173 を許可済み)。

## API の回数制限

- Nature Remo: 5 分で 30 回まで
- SwitchBot: 1 日 10,000 回まで

Lambda 側で一覧を 1 分 (SwitchBot の機器リストは 10 分) キャッシュし、画面の自動更新も 2 分ごと・表示中のみにしています。

## AWS の利用料

AWS の利用料とクレジットの表示は、ダッシュボード [wakalabo-apps](https://github.com/ikumi10132/wakalabo-apps) (apps.wakalabo.net) に移しました。
このアプリの AWS リソースには `app=smart-home` のタグを付けてあり、アプリ別の利用料として集計されます。

## 費用の目安

個人利用ならほぼ無料枠内です (CloudFront / Lambda / API Gateway / SSM)。
CloudWatch Logs は 1 か月で自動削除されます。
