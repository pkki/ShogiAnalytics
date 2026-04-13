import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';

const LAST_UPDATED = '2026年3月30日';

const PRIVACY_JA = {
  title: 'プライバシーポリシー',
  description: '将棋アナリティクスのプライバシーポリシーです。個人情報の取り扱いについて説明しています。',
  intro: '将棋アナリティクス（以下「本サービス」）は、ユーザーのプライバシーを尊重し、個人情報の保護に努めます。本ポリシーでは、収集する情報とその利用方法について説明します。',
  sections: [
    {
      title: '1. 収集する情報',
      body: `本サービスは以下の情報を収集します。

【アカウント情報】
・メールアドレス（アカウント登録・本人確認のため）
・パスワード（bcryptによりハッシュ化して保存）

【利用データ】
・保存・共有した棋譜データ
・サービス利用に関するログ（エラーログ等）

【自動収集情報】
・IPアドレス（セキュリティ目的）
・ブラウザの種類・バージョン

なお、クレジットカード情報などの決済情報は当サービスのサーバーには保存しません。`,
    },
    {
      title: '2. 情報の利用目的',
      body: `収集した情報は以下の目的で利用します。
・本サービスの提供・運営・改善
・ユーザー認証およびアカウント管理
・お問い合わせへの対応
・利用規約違反等の調査・対応
・サービスに関する重要なお知らせの送信`,
    },
    {
      title: '3. 第三者への提供',
      body: `以下の場合を除き、ユーザーの個人情報を第三者に提供しません。
・ユーザー本人の同意がある場合
・法令に基づく開示要請があった場合
・人の生命・身体・財産の保護に必要な場合`,
    },
    {
      title: '4. データの保管',
      body: `収集したデータはサーバー（SQLiteデータベース）に保存されます。
不正アクセス防止のため、適切なセキュリティ対策を講じています。
アカウント削除を希望される場合はお問い合わせください。削除後は復元できません。`,
    },
    {
      title: '5. Cookieおよびローカルストレージ',
      body: `本サービスはログイン状態の維持にJWTトークンをlocalStorageに保存します。
これはサービス提供に必要な技術的情報であり、広告目的での利用はありません。`,
    },
    {
      title: '6. お子様のプライバシー',
      body: `本サービスは13歳未満のお子様を対象としていません。
13歳未満の方の個人情報を意図的に収集しないようにしています。`,
    },
    {
      title: '7. プライバシーポリシーの変更',
      body: `本ポリシーは必要に応じて変更することがあります。
重要な変更がある場合は、本ページへの掲載をもってお知らせします。`,
    },
    {
      title: '8. お問い合わせ',
      body: `個人情報の取り扱いに関するお問い合わせは、サービス内のお問い合わせフォームよりご連絡ください。`,
    },
  ],
};

const PRIVACY_EN = {
  title: 'Privacy Policy',
  description: 'Privacy Policy for Shogi Analytics. Explains how personal information is handled.',
  intro: `Shogi Analytics respects your privacy and is committed to protecting your personal information. This policy explains what information we collect and how we use it.`,
  sections: [
    {
      title: '1. Information We Collect',
      body: `We collect the following information:

【Account Information】
・Email address (for account registration and identity verification)
・Password (hashed with bcrypt for storage)

【Usage Data】
・Saved and shared game records
・Service usage logs (including error logs)

【Automatically Collected Information】
・IP address (for security purposes)
・Browser type and version

We do not store payment information such as credit card numbers on our servers.`,
    },
    {
      title: '2. How We Use Your Information',
      body: `We use collected information for the following purposes:
・Providing, operating, and improving the service
・User authentication and account management
・Responding to inquiries
・Investigating and addressing terms of service violations
・Sending important service announcements`,
    },
    {
      title: '3. Sharing with Third Parties',
      body: `We do not share user personal information with third parties except in the following cases:
・With explicit user consent
・In response to legal disclosure requests
・When necessary to protect the life, body, or property of individuals`,
    },
    {
      title: '4. Data Storage',
      body: `Collected data is stored on our server (SQLite database).\nWe implement appropriate security measures to prevent unauthorized access.\nIf you wish to delete your account, please contact us. Deletion cannot be reversed.`,
    },
    {
      title: '5. Cookies and Local Storage',
      body: `We store JWT tokens in localStorage to maintain your login state.\nThis is technical information necessary for service delivery and is not used for advertising.`,
    },
    {
      title: '6. Children\'s Privacy',
      body: `This service is not intended for children under 13.\nWe do not intentionally collect personal information from children under 13.`,
    },
    {
      title: '7. Privacy Policy Changes',
      body: `We may modify this policy as needed.\nWhen significant changes occur, we will notify you by posting the updated policy on this page.`,
    },
    {
      title: '8. Contact Us',
      body: `For inquiries about our handling of personal information, please contact us using the contact form within the service.`,
    },
  ],
};

export default function PrivacyPage() {
  const { t } = useTranslation();
  const isJa = t('common.language') !== 'Language';
  const privacy = isJa ? PRIVACY_JA : PRIVACY_EN;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <Helmet>
        <title>{privacy.title} | {t('appName')}</title>
        <meta name="description" content={privacy.description} />
        <link rel="canonical" href="https://analytics.pkkis.com/privacy" />
        <meta property="og:title" content={`${privacy.title} | ${t('appName')}`} />
        <meta property="og:url" content="https://analytics.pkkis.com/privacy" />
      </Helmet>
      <header className="px-6 py-4 border-b border-gray-800 sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-gray-400 hover:text-white transition-colors text-sm">{isJa ? '← 戻る' : '← Back'}</Link>
          <h1 className="font-bold text-white text-sm">{privacy.title}</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-8">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">{privacy.title}</h2>
          <p className="text-xs text-gray-500">Last Updated: {LAST_UPDATED}</p>
        </div>

        <p className="text-sm text-gray-400 leading-relaxed">
          {privacy.intro}
        </p>

        {privacy.sections.map(({ title, body }) => (
          <section key={title} className="flex flex-col gap-2">
            <h3 className="text-base font-bold text-white">{title}</h3>
            <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{body}</p>
          </section>
        ))}

        <div className="border-t border-gray-800 pt-6 flex gap-4 text-xs text-gray-500">
          <Link to="/terms" className="hover:text-gray-300 transition-colors">{isJa ? '利用規約' : 'Terms of Service'}</Link>
          <Link to="/" className="hover:text-gray-300 transition-colors">{isJa ? 'トップページ' : 'Home'}</Link>
        </div>
      </main>
    </div>
  );
}
