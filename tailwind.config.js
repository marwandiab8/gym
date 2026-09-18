/** Build-time Tailwind config: replaces the in-browser Play CDN so phones never compile CSS at launch. */
module.exports = {
  darkMode: "class",
  content: ["./public/**/*.html", "./public/app.js", "./public/js/**/*.js"],
  theme: { extend: {} },
  plugins: [],
};
