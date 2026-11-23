/** POST /api/vitals: Core Web Vitals from real visits, written to Workers Logs. */
import { vValidator } from '@hono/valibot-validator';
import * as v from 'valibot';
import { VITAL_NAMES } from '../../src/web-vitals-report.ts';
import { log } from '../log.ts';
import { apiBodies, factory, fail, refuseWith } from './context.ts';
import { VitalMetricSchema, VitalsReportSchema } from './inputs.ts';

export const vitalsRoutes = factory.createApp()
  .post('/vitals', apiBodies, vValidator('json', VitalsReportSchema, refuseWith(400)), (c) => {
    const { page, metrics } = c.req.valid('json');
    let logged = 0;
    for (const metric of metrics.slice(0, VITAL_NAMES.length)) {
      const result = v.safeParse(VitalMetricSchema, metric);
      if (!result.success) continue;
      log.info('web_vital', { ...result.output, page });
      logged++;
    }
    return logged ? c.body(null, 204) : fail(c, 400, 'Send Core Web Vitals measurements.');
  });
