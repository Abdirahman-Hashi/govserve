import { type NotificationDto } from '@govserve/shared';
import { Link } from 'react-router';
import { useMarkAllRead, useMarkRead, useNotifications } from '../../api/notifications';
import { FormAlert } from '../../components/form';
import { t } from '../../strings';

const n = t.notifications;

function Item({ item }: { item: NotificationDto }) {
  const markRead = useMarkRead();
  const title = n.titles[item.template]?.(item.vars.referenceNo ?? '') ?? item.template;
  const unread = item.readAt === null;
  return (
    <li
      className={`space-y-1 border-l-4 p-3 ${unread ? 'border-brand bg-blue-50' : 'border-slate-200'}`}
    >
      <p className="font-medium">
        {unread && <span className="sr-only">{n.unread}: </span>}
        {item.link ? (
          <Link
            to={item.link}
            className="underline"
            onClick={() => unread && markRead.mutate(item.id)}
          >
            {title}
          </Link>
        ) : (
          title
        )}
      </p>
      <p className="text-sm text-slate-600">
        <time dateTime={item.createdAt}>
          {new Date(item.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Mogadishu' })}
        </time>
        {item.emailStatus === 'SKIPPED' && ` · ${n.emailSkipped}`}
        {(item.emailStatus === 'DEAD' || item.emailStatus === 'FAILED') && ` · ${n.emailFailed}`}
      </p>
      {unread && (
        <button
          type="button"
          className="text-sm underline"
          onClick={() => markRead.mutate(item.id)}
        >
          {n.markRead}
        </button>
      )}
    </li>
  );
}

export function NotificationsPage() {
  const list = useNotifications();
  const markAll = useMarkAllRead();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{n.heading}</h1>
        {items.some((i) => i.readAt === null) && (
          <button type="button" className="underline" onClick={() => markAll.mutate(undefined)}>
            {n.markAll}
          </button>
        )}
      </div>
      {list.isPending && <p role="status">{t.loading}</p>}
      {list.isError && <FormAlert>{t.errors.generic}</FormAlert>}
      {list.isSuccess && items.length === 0 && <p>{n.none}</p>}
      <ul className="space-y-2" data-testid="notifications">
        {items.map((i) => (
          <Item key={i.id} item={i} />
        ))}
      </ul>
      {list.hasNextPage && (
        <button
          type="button"
          className="rounded-md border border-slate-400 px-4 py-2"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {n.more}
        </button>
      )}
    </div>
  );
}
