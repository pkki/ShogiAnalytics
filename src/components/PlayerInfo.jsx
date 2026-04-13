import { useTranslation } from 'react-i18next';

export default function PlayerInfo({ name, mark, time, isActive, player, inCheck, compact = false }) {
  const { t } = useTranslation();
  const dotColor = player === 1 ? 'bg-blue-400 shadow-blue-400/60' : 'bg-red-400 shadow-red-400/60';
  return (
    <div className={`flex items-center justify-between transition-colors
      ${compact ? 'px-2 py-0.5 rounded-lg' : 'px-3 py-2 rounded-xl'}
      ${isActive && inCheck
        ? 'bg-red-900/60 border border-red-500/70'
        : isActive
          ? 'bg-gray-700/80 border border-gray-600'
          : 'bg-gray-800/40 border border-transparent'}`}
    >
      <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
        <div className={`rounded-full transition-all
          ${compact ? 'w-2 h-2' : 'w-2.5 h-2.5'}
          ${isActive ? `${dotColor} shadow-md scale-110` : 'bg-gray-600'}`} />
        <span className={`font-bold ${compact ? 'text-xs' : 'text-sm'} ${isActive ? 'text-white' : 'text-gray-400'}`}>
          {mark} {name}
        </span>
        {isActive && inCheck && (
          <span className={`font-bold text-red-400 animate-pulse ${compact ? 'text-[10px]' : 'text-xs'}`}>
            {t('game.inCheck')}
          </span>
        )}
      </div>
      <span className={`font-mono tabular-nums ${compact ? 'text-xs' : 'text-sm'} ${isActive ? 'text-white font-bold' : 'text-gray-500'}`}>
        {time}
      </span>
    </div>
  );
}
