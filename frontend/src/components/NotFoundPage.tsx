import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function NotFoundPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <Card className="p-8 sm:p-10 w-full max-w-md mx-4 text-center flex flex-col items-center gap-4 shadow-md">
        <h1 className="font-display text-5xl font-bold text-primary">404</h1>
        <h2 className="font-display text-xl font-bold text-foreground">Page not found</h2>
        <p className="text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Button asChild>
          <Link to="/app">Go to app</Link>
        </Button>
      </Card>
    </div>
  );
}
