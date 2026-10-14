import { type NextFunction, type Request, type Response } from 'express';
import { type MetricsService } from './metrics.service';

/** Counts every request by matched route (never the raw URL, which can hold ids or tokens). */
export function httpMetrics(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const end = metrics.httpDuration.startTimer();
    res.on('finish', () => {
      const path = req.route ? `${req.baseUrl}${(req.route as { path: string }).path}` : '';
      // No route, or Nest's not-found catch-all ({/*splat}): one label for every unknown path.
      const route = path && !path.includes('*') ? path : 'unmatched';
      if (route === '/metrics') return;
      end({ method: req.method, route });
      metrics.httpRequests.inc({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  };
}
