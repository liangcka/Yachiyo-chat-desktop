/** 余额小鲸鱼的自绘形象：朝左的圆胖鲸鱼，尾巴上翘，头顶喷水 */
export function WhaleMark({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size * (60 / 72)}
      viewBox="0 0 72 60"
      aria-hidden="true"
      focusable="false"
    >
      <g className="whale-mark__spout" fill="none" stroke="#8fb8ff" strokeWidth="2.2" strokeLinecap="round">
        <path d="M27 15c0-4-2.5-6.5-5-8" />
        <path d="M27 15c0-4 2.5-6.5 5-8" />
        <path d="M27 14V6" />
      </g>
      <path
        fill="#4d6bfe"
        d="M54 33c3-1.5 5.6-5.4 6.4-10.6.2-1 1.3-1.4 2-.7 1.4 1.4 3.6 1.9 5.7 1.2 1-.3 1.8.7 1.3 1.6-1.6 3-4.3 5.2-7.4 6.2 2.7 1.1 4.6 3.4 5.3 6.2.2 1-.8 1.7-1.7 1.2-2.6-1.4-5.8-1.3-8.4.4z"
      />
      <path
        fill="#4d6bfe"
        d="M7 36c0-11.6 10.6-20 24.6-20C45 16 56 23.6 56 35c0 10.4-9.6 17-24 17C17 52 7 46.4 7 36z"
      />
      <path fill="#e9eeff" d="M9.4 40.6C13 47 21.6 50.4 31.6 50.4c10.4 0 18.4-3.6 21.8-9.6-6.4 3.4-14.4 5-22.6 5-8.6 0-15.8-1.8-21.4-5.2z" />
      <path fill="#3d58e0" d="M33 43.4c-1.4 3.4-4.6 5.8-8.4 6.2 1-3.4 4-6 8.4-6.2z" />
      <circle cx="21" cy="31.5" r="2.8" fill="#1b2340" />
      <circle cx="22" cy="30.4" r="0.95" fill="#ffffff" />
      <ellipse cx="17" cy="37.4" rx="3" ry="1.7" fill="#ff9fb6" opacity="0.75" />
      <path d="M23.4 37.6c1.2 1.4 3.2 1.4 4.4 0" fill="none" stroke="#1b2340" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
