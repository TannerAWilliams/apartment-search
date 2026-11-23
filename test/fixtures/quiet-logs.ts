// Tests exercise many failures on purpose; their log lines would bury the test report.
import { log } from '../../server/log.ts';

log.sink = () => {};
