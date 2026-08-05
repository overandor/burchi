/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        secondary: "hsl(var(--secondary))",
        "secondary-foreground": "hsl(var(--secondary-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        accent: "hsl(var(--accent))",
        "accent-foreground": "hsl(var(--accent-foreground))",
        destructive: "hsl(var(--destructive))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        status: {
          new: "hsl(var(--status-new))",
          working: "hsl(var(--status-working))",
          needs: "hsl(var(--status-needs))",
          completed: "hsl(var(--status-completed))",
          blocked: "hsl(var(--status-blocked))",
        },
        // SPINOR organic color system
        gold: "hsl(var(--spinor-gold))",
        spinor: {
          blue: "hsl(var(--spinor-blue))",
          violet: "hsl(var(--spinor-violet))",
          green: "hsl(var(--spinor-green))",
          gold: "hsl(var(--spinor-gold))",
          red: "hsl(var(--spinor-red))",
          gray: "hsl(var(--spinor-gray))",
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
