import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ChordExplorer, { type ChordSelection } from '@/components/chords/ChordExplorer';
import { chordPath, resolveChordRoute } from '@/lib/chords/chordUrl';
import { DEFAULT_INSTRUMENT } from '@/lib/chords/instruments';
import { CHORD_QUALITIES } from '@/lib/chords/theory';

/**
 * The chord dictionary as an app tab.
 *
 * Instrument, chord, tuning, and capo all live in the URL rather than in
 * component state, so a chord can be linked, bookmarked, and reached with the
 * back button. The public version of this page (premium only, at `/chords`)
 * renders the same component under a marketing layout, which is what gives each
 * chord an address a search result can point at.
 */

const DEFAULT_CHORD = { root: 0, quality: CHORD_QUALITIES[0]! };
const HIGHEST_CAPO = 11;

interface ChordsPageProps {
  /** Route prefix these URLs live under: "/app/chords" in the app, "/chords" publicly. */
  basePath?: string;
  /** Rendered above the explorer. The public page supplies its own marketing copy. */
  heading?: React.ReactNode;
}

export default function ChordsPage({ basePath = '/app/chords', heading }: ChordsPageProps) {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const [showAllQualities, setShowAllQualities] = useState(false);

  const defaultPath = chordPath(basePath, DEFAULT_INSTRUMENT, DEFAULT_CHORD);
  const route = resolveChordRoute(params.instrument, params.chord, search.get('tuning') ?? undefined);

  // No chord named, or one we cannot read. Either way the address bar does not
  // name a chord we can show, and rendering a different one anyway would be
  // worse than sending them to the chord most people came for.
  if (!route) return <Navigate to={defaultPath} replace />;

  // "a-sharp-m7" and "b-flat-m7" are one chord. Collapse to one address so the
  // page does not compete with itself in search results.
  if (route.shouldRedirect) {
    const query = search.toString();
    return <Navigate to={`${chordPath(basePath, route.instrument, route.chord)}${query ? `?${query}` : ''}`} replace />;
  }

  const capo = Math.min(HIGHEST_CAPO, Math.max(0, Math.trunc(Number(search.get('capo'))) || 0));
  const selection: ChordSelection = { ...route, capo };

  const handleChange = (next: Partial<ChordSelection>) => {
    const instrument = next.instrument ?? selection.instrument;
    const chord = next.chord ?? selection.chord;
    // Switching instrument resets the tuning: "baritone" means nothing on a banjo.
    const tuning = next.tuning ?? (next.instrument ? next.instrument.tunings[0]! : selection.tuning);
    const nextCapo = next.capo ?? selection.capo;

    // Defaults stay out of the URL, so the address of a plain chord is clean and
    // every link to it is the same string.
    const query = new URLSearchParams(search);
    if (tuning.slug === instrument.tunings[0]!.slug) query.delete('tuning');
    else query.set('tuning', tuning.slug);
    if (nextCapo === 0) query.delete('capo');
    else query.set('capo', String(nextCapo));
    const suffix = query.toString() ? `?${query}` : '';

    const path = chordPath(basePath, instrument, chord);
    // Picking a different chord is navigation and should stack in history.
    // Nudging the capo is not, and would otherwise bury the back button.
    if (path !== chordPath(basePath, selection.instrument, selection.chord)) navigate(`${path}${suffix}`);
    else setSearch(query, { replace: true });
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-1 py-2 flex flex-col gap-6">
      {heading ?? (
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-3xl sm:text-4xl">Chord shapes</h1>
          <p className="text-muted-foreground text-sm">
            Fingerings for guitar, ukulele, mandolin, and banjo, in standard and alternate tunings.
          </p>
        </header>
      )}

      <ChordExplorer
        selection={selection}
        onChange={handleChange}
        showAllQualities={showAllQualities}
        onToggleAllQualities={() => setShowAllQualities(v => !v)}
      />
    </div>
  );
}

