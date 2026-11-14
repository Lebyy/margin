// Tailwind 4 runs as a PostCSS plugin. HeroUI's styles are Tailwind 4 CSS, so without this plugin every HeroUI component renders unstyled.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
