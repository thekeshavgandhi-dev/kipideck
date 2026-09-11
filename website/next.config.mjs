/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Plain marketing site — no server actions/APIs, so a fully static export
  // works great and is the simplest possible thing for Vercel to deploy.
  // (Left as the default Node server build instead of `output: "export"`
  // so future dynamic bits — e.g. a waitlist API route — can be added
  // without a config change. Either way, Vercel builds this with zero
  // extra configuration.)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
