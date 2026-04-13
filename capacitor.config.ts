import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shogianalytics.app',
  appName: '将棋アナリティクス',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // 本番サーバーURL (ビルド済みアセットを使う場合は不要)
    // url: 'https://your-server.example.com',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
