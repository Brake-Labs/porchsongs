import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <>
      <title>porchsongs | Your chord charts, ready to play</title>
      <meta name="description" content="Keep your chord charts in one place and play them from any screen. Built-in tuner, hands-free scrolling, and a clean performance view. Optional AI to tidy up a messy chart or rewrite the words." />
      <meta property="og:title" content="porchsongs | Your chord charts, ready to play" />
      <meta property="og:description" content="Keep your chord charts in one place and play them from any screen." />
      <meta property="og:type" content="website" />

      {/* Hero */}
      <section className="relative py-20 sm:py-28 px-4 text-center overflow-hidden">
        {/* Subtle radial gradient accent behind the hero text */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            background: 'radial-gradient(ellipse 60% 50% at 50% 40%, var(--color-primary-light) 0%, transparent 70%)',
          }}
        />
        <div className="relative">
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-normal mb-5 text-foreground tracking-tight">
            Your chord charts, ready to play
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-4 leading-relaxed">
            Keep every chart in one place, then play it from whatever screen is on the music stand.
          </p>
          <p className="text-base text-muted-foreground max-w-xl mx-auto mb-10">
            A tuner, hands-free scrolling, and text big enough to read from across the room.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Link
              to="/app/library"
              className="bg-primary text-white px-7 py-3 rounded-full text-base font-semibold no-underline hover:bg-primary-hover transition-colors shadow-sm"
            >
              Get Started Free
            </Link>
            <Link
              to="/pricing"
              className="border border-border text-foreground px-7 py-3 rounded-full text-base font-semibold no-underline hover:bg-panel transition-colors"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="py-14 px-4 bg-panel">
        <h2 className="font-display text-3xl font-normal text-center mb-8">How it works</h2>
        <div className="max-w-5xl mx-auto grid sm:grid-cols-3 gap-6">
          <div className="bg-card border border-border rounded-lg p-6 text-center shadow-sm">
            <div className="w-10 h-10 mx-auto mb-4 rounded-full bg-primary-light flex items-center justify-center text-lg">
              &#9835;
            </div>
            <h3 className="text-lg font-semibold mb-2">Bring Charts In</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Paste a chart, drop a file, or add a link. It saves as you typed it, free and instantly.
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-6 text-center shadow-sm">
            <div className="w-10 h-10 mx-auto mb-4 rounded-full bg-primary-light flex items-center justify-center text-lg">
              &#128172;
            </div>
            <h3 className="text-lg font-semibold mb-2">Play From Anywhere</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              A full-screen chart with a tuner, sizable text, and scrolling that follows your voice.
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-6 text-center shadow-sm">
            <div className="w-10 h-10 mx-auto mb-4 rounded-full bg-primary-light flex items-center justify-center text-lg">
              &#128218;
            </div>
            <h3 className="text-lg font-semibold mb-2">Your Songbook</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Organise charts into folders and export any of them as a printable PDF.
            </p>
          </div>
        </div>
      </section>

      {/* Demo video */}
      <section className="py-14 sm:py-20 px-4 text-center">
        <h2 className="font-display text-3xl font-normal mb-8">See it in action</h2>
        <div className="max-w-4xl mx-auto">
          <video
            src="/porchsongs-demo.mp4"
            autoPlay
            muted
            loop
            playsInline
            aria-label="porchsongs demo"
            className="rounded-lg shadow-lg border border-border w-full"
          />
        </div>
      </section>

    </>
  );
}
