/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        card: "hsl(var(--card) / <alpha-value>)",
        "card-foreground": "hsl(var(--card-foreground) / <alpha-value>)",
        primary: "hsl(var(--primary) / <alpha-value>)",
        "primary-foreground": "hsl(var(--primary-foreground) / <alpha-value>)",
        secondary: "hsl(var(--secondary) / <alpha-value>)",
        "secondary-foreground": "hsl(var(--secondary-foreground) / <alpha-value>)",
        muted: "hsl(var(--muted) / <alpha-value>)",
        "muted-foreground": "hsl(var(--muted-foreground) / <alpha-value>)",
        accent: "hsl(var(--accent) / <alpha-value>)",
        "accent-foreground": "hsl(var(--accent-foreground) / <alpha-value>)",
        destructive: "hsl(var(--destructive) / <alpha-value>)",
        "destructive-foreground": "hsl(var(--destructive-foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        status: {
          new: "hsl(var(--status-new) / <alpha-value>)",
          working: "hsl(var(--status-working) / <alpha-value>)",
          needs: "hsl(var(--status-needs) / <alpha-value>)",
          completed: "hsl(var(--status-completed) / <alpha-value>)",
          blocked: "hsl(var(--status-blocked) / <alpha-value>)",
        },
        // SPINOR organic color system
        gold: "hsl(var(--spinor-gold) / <alpha-value>)",
        spinor: {
          blue: "hsl(var(--spinor-blue) / <alpha-value>)",
          violet: "hsl(var(--spinor-violet) / <alpha-value>)",
          green: "hsl(var(--spinor-green) / <alpha-value>)",
          gold: "hsl(var(--spinor-gold) / <alpha-value>)",
          red: "hsl(var(--spinor-red) / <alpha-value>)",
          gray: "hsl(var(--spinor-gray) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "monospace"],
      },
    },
  },
  plugins: [],
};
