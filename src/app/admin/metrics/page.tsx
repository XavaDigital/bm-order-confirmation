import { countFailedEvents } from '@/server/events/processor';
import { getSession } from '@/lib/session';
import { MetricsView } from './MetricsView';
import { getMetricsData } from './queries';

export default async function MetricsPage() {
  const session = await getSession();
  const [data, failedEventCounts] = await Promise.all([
    getMetricsData(),
    // Outbox delivery failures are an ops concern — admin only (roadmap 3.1).
    session.role === 'admin' ? countFailedEvents() : Promise.resolve({ failed: 0, dead: 0 }),
  ]);
  return (
    <MetricsView
      {...data}
      role={session.role}
      failedEventsCount={failedEventCounts.failed + failedEventCounts.dead}
      deadFailedEventsCount={failedEventCounts.dead}
    />
  );
}
