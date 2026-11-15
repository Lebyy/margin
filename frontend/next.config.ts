import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits in the bottom-left corner, which is where the student
  // sidebar puts the profile menu and, folded, the Margin mark. Build and
  // runtime errors still open their overlay; only the idle badge is hidden.
  devIndicators: false,
};

export default nextConfig;
