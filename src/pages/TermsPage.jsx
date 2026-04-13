import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';

const LAST_UPDATED = '2026年3月30日';

const TERMS_JA = {
  title: '利用規約',
  description: '将棋アナリティクスの利用規約です。サービスをご利用になる前にお読みください。',
  sections: [
    {
      title: '第1条（適用）',
      body: `本規約は、本サービスの利用に関わるすべての関係に適用されます。
本サービスを利用することで、本規約のすべての条項に同意したものとみなします。`,
    },
    {
      title: '第2条（アカウント）',
      body: `ユーザーは、正確かつ最新の情報を登録する責任を負います。
アカウントのパスワードは適切に管理し、第三者に開示しないでください。
アカウントを通じて行われた行為については、ユーザー自身が責任を負います。
不正利用が発覚した場合は直ちにご連絡ください。`,
    },
    {
      title: '第3条（禁止事項）',
      body: `以下の行為を禁止します。
・法令または公序良俗に違反する行為
・本サービスのサーバーや通信に過大な負荷をかける行為
・本サービスを通じて第三者に不利益・損害を与える行為
・不正アクセス・リバースエンジニアリング等の行為
・虚偽の情報を登録する行為
・その他、当サービスが不適切と判断する行為`,
    },
    {
      title: '第4条（サービスの変更・停止）',
      body: `当サービスは、ユーザーへの事前通知なく、本サービスの内容を変更または停止することがあります。
これによりユーザーに生じた損害について、当サービスは責任を負いません。`,
    },
    {
      title: '第5条（免責事項）',
      body: `本サービスは現状有姿で提供されます。
本サービスの利用によって生じた損害（データの消失・サービス停止等を含む）について、当サービスは一切責任を負いません。
将棋エンジンの解析結果はあくまで参考情報であり、その正確性を保証するものではありません。`,
    },
    {
      title: '第6条（知的財産権）',
      body: `本サービスに関する知的財産権は当サービスに帰属します。
ユーザーが投稿・保存した棋譜データの権利はユーザーに帰属しますが、
本サービスの提供に必要な範囲で利用する権利を当サービスに許諾するものとします。`,
    },
    {
      title: '第7条（規約の変更）',
      body: `当サービスは、必要に応じて本規約を変更することがあります。
変更後の規約は本ページに掲載した時点から効力を生じます。
重要な変更の際は、可能な範囲でご連絡します。`,
    },
    {
      title: '第8条（準拠法・管轄）',
      body: `本規約の解釈は日本法に準拠します。
本サービスに関する紛争については、当サービス運営者の所在地を管轄する裁判所を専属合意管轄とします。`,
    },
  ],
};

const TERMS_EN = {
  title: 'Terms of Service',
  description: 'Terms of Service for Shogi Analytics. Please read before using the service.',
  sections: [
    { title: 'Article 1 (Application)', body: `These Terms apply to all matters related to the use of this service.\nBy using the service, you are deemed to have agreed to all terms herein.` },
    { title: 'Article 2 (Account)', body: `You are responsible for providing accurate and up-to-date information.\nManage your password appropriately and do not disclose it to third parties.\nYou are responsible for all actions taken through your account.\nIf unauthorized use is discovered, please contact us immediately.` },
    { title: 'Article 3 (Prohibited Acts)', body: `The following acts are prohibited:\n· Acts violating laws or public order\n· Acts imposing excessive load on service servers or communications\n· Acts causing disadvantage or damage to third parties through the service\n· Unauthorized access or reverse engineering\n· Registration of false information\n· Other acts deemed inappropriate by the service` },
    { title: 'Article 4 (Service Modification/Suspension)', body: `The service may modify or suspend its contents without prior notice to users.\nThe service is not responsible for damages incurred by users due to such changes.` },
    { title: 'Article 5 (Disclaimer)', body: `The service is provided on an "as-is" basis.\nThe service is not responsible for any damages resulting from use (including data loss, service interruptions).\nShogi engine analysis results are for reference only and accuracy is not guaranteed.` },
    { title: 'Article 6 (Intellectual Property)', body: `Intellectual property rights related to the service belong to the service operator.\nUser-posted and saved game records belong to the user, but the user grants the service permission to use them as necessary for service provision.` },
    { title: 'Article 7 (Changes to Terms)', body: `The service may revise these Terms as needed.\nRevised Terms become effective when posted on this page.\nWhere significant changes are made, notice will be given if possible.` },
    { title: 'Article 8 (Governing Law)', body: `These Terms are governed by Japanese law.\nAny disputes related to the service are subject to the exclusive jurisdiction of courts in the operator's location.` },
  ],
};

export default function TermsPage() {
  const { t } = useTranslation();
  const isJa = t('common.language') !== 'Language';
  const terms = isJa ? TERMS_JA : TERMS_EN;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <Helmet>
        <title>{terms.title} | {t('appName')}</title>
        <meta name="description" content={terms.description} />
        <link rel="canonical" href="https://analytics.pkkis.com/terms" />
        <meta property="og:title" content={`${terms.title} | ${t('appName')}`} />
        <meta property="og:url" content="https://analytics.pkkis.com/terms" />
      </Helmet>
      <header className="px-6 py-4 border-b border-gray-800 sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Link to="/" className="text-gray-400 hover:text-white transition-colors text-sm">{isJa ? '← 戻る' : '← Back'}</Link>
          <h1 className="font-bold text-white text-sm">{terms.title}</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 flex flex-col gap-8">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">{terms.title}</h2>
          <p className="text-xs text-gray-500">Last Updated: {LAST_UPDATED}</p>
        </div>

        <p className="text-sm text-gray-400 leading-relaxed">
          {isJa
            ? `本利用規約（以下「本規約」）は、将棋アナリティクス（以下「本サービス」）の利用条件を定めるものです。ユーザーの皆様は、本規約に同意の上、本サービスをご利用ください。`
            : `These Terms of Service govern the use of Shogi Analytics. By using the service, you agree to these terms.`}
        </p>

        {terms.sections.map(({ title, body }) => (
          <section key={title} className="flex flex-col gap-2">
            <h3 className="text-base font-bold text-white">{title}</h3>
            <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{body}</p>
          </section>
        ))}

        <div className="border-t border-gray-800 pt-6 flex gap-4 text-xs text-gray-500">
          <Link to="/privacy" className="hover:text-gray-300 transition-colors">{isJa ? 'プライバシーポリシー' : 'Privacy Policy'}</Link>
          <Link to="/" className="hover:text-gray-300 transition-colors">{isJa ? 'トップページ' : 'Home'}</Link>
        </div>
      </main>
    </div>
  );
}
