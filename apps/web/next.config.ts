import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@protarget/shared', '@protarget/i18n'],
};

export default nextConfig;
