import { Link } from 'react-router';
import { t } from '../strings';

export function NotFoundPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">{t.notFound.heading}</h1>
      <Link to="/" className="text-brand underline">
        {t.notFound.back}
      </Link>
    </div>
  );
}
