const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 本番（npm run build:prod / start:prod）は .next-prod に分ける。
  // 開発サーバー（npm run dev）を動かしたままでもビルドでき、.next を壊さない
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // このフォルダ単体で完結したアプリなので、探索の起点をここに固定する
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ['sharp', 'archiver'],
};

module.exports = nextConfig;
