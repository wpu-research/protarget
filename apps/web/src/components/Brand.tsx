import Image from 'next/image';

export function Brand() {
  return <span className="brand-lockup">
    <Image className="brand-logo" src="/brand/protarget-mark.png" alt="" aria-hidden="true"
      width={184} height={131} unoptimized />
    <span className="wordmark">protarget<span>.</span></span>
  </span>;
}
