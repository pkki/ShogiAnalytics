export default function PlayerInfo({ name, mark, time, isActive, player, inCheck }) {
  const dotColor = player === 1 ? 'bg-blue-400 shadow-blue-400/60' : 'bg-red-400 shadow-red-400/60';
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-xl transition-colors
      ${isActive && inCheck
        ? 'bg-red-900/60 border border-red-500/70'
        : isActive
          ? 'bg-gray-700/80 border border-gray-600'
          : 'bg-gray-800/40 border border-transparent'}`}
    >
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full transition-all
          ${isActive ? `${dotColor} shadow-md scale-110` : 'bg-gray-600'}`} />
        <span className={`text-sm font-bold ${isActive ? 'text-white' : 'text-gray-400'}`}>
          {mark} {name}
        </span>
        {isActive && inCheck && (
          <span className="text-xs font-bold text-red-400 animate-pulse">王手</span>
        )}
      </div>
      <span className={`font-mono text-sm tabular-nums ${isActive ? 'text-white font-bold' : 'text-gray-500'}`}>
        {time}
      </span>
    </div>
  );
}
