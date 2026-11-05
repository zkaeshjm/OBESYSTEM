import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, Card } from '../components/ui';

export default function NotFound() {
  return (
    <Card className="mx-auto max-w-lg px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-500">
        <Compass size={24} />
      </div>
      <h1 className="text-lg font-bold text-gray-900">Page not found</h1>
      <p className="mt-1 text-xs text-gray-500">The page you requested does not exist or you no longer have access to it.</p>
      <Link to="/" className="mt-5 inline-block">
        <Button>Back to dashboard</Button>
      </Link>
    </Card>
  );
}
