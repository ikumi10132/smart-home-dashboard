// 画面 (CloudFront) の応答ヘッダー: Content-Security-Policy (CSP) と、これまでの安全のためのヘッダー。
// wakalabo の各アプリで同じものを使う (wakalabo-apps/infra/lib/csp.ts からコピーする)。
//
// CSP: 画面で動かしてよいスクリプトと、通信してよい相手を決める。
// もし悪いスクリプトが入り込んでも、外にログイン情報を送ったり、よそのスクリプトを読み込んだりできないようにする。
// 古い iPad 対応 (@vitejs/plugin-legacy) が index.html に 1 行だけスクリプトを直接書くので、その中身のハッシュだけを許可する。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type { Construct } from 'constructs';

/** ビルドした HTML に直接書かれた <script> (src なし) の中身のハッシュ */
export function inlineScriptHashes(distDir: string): string[] {
  const hashes = new Set<string>();
  for (const file of readdirSync(distDir).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(path.join(distDir, file), 'utf8');
    for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      if (m[1]!.trim()) hashes.add(`'sha256-${createHash('sha256').update(m[1]!, 'utf8').digest('base64')}'`);
    }
  }
  return [...hashes];
}

export interface CspOptions {
  /** ビルドした画面のフォルダ (web/dist) */
  distDir: string;
  region: string;
  /** 自分の API・W-SSO・ログの送り先のほかに通信する相手 (例 https://waripo.wakalabo.net) */
  connect?: string[];
}

export function contentSecurityPolicy(o: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...inlineScriptHashes(o.distDir)],
    // React の style 属性と、古い iPad 向けにスクリプトから入れる CSS があるので、スタイルだけはインラインを許す
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:'],
    // 各アプリの API とログの送り先 (API Gateway)、W-SSO のログインの更新 (Cognito)
    'connect-src': [
      "'self'",
      `https://*.execute-api.${o.region}.amazonaws.com`,
      `https://cognito-idp.${o.region}.amazonaws.com`,
      ...(o.connect ?? []),
    ],
    'manifest-src': ["'self'"],
    'worker-src': ["'self'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
}

/** CloudFront の SECURITY_HEADERS (AWS が用意したもの) と同じ内容に CSP を足した応答ヘッダーのポリシー */
export function securityHeadersPolicy(scope: Construct, id: string, o: CspOptions): cloudfront.ResponseHeadersPolicy {
  return new cloudfront.ResponseHeadersPolicy(scope, id, {
    comment: '安全のためのヘッダー + CSP',
    securityHeadersBehavior: {
      contentSecurityPolicy: { contentSecurityPolicy: contentSecurityPolicy(o), override: true },
      contentTypeOptions: { override: true },
      frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
      referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
      strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: false, override: true },
      xssProtection: { protection: true, modeBlock: true, override: true },
    },
  });
}
