interface BrandMarkProps {
  size?: number;
  className?: string;
}

/** 单色品牌字形：月牙加一颗小星，随 currentColor 适配明暗主题。 */
export function BrandMark({ size = 18, className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13.2 3.1A9 9 0 1 0 20.9 14.4 7.2 7.2 0 0 1 13.2 3.1Z" />
      <path d="M18.6 3.2l.62 1.58 1.58.62-1.58.62-.62 1.58-.62-1.58-1.58-.62 1.58-.62Z" />
    </svg>
  );
}
