import express from 'express';
import { logCall, getAnalyticsBySalesperson, getTodayAnalyticsForAll } from '../controllers/analyticsController.js';

const router = express.Router();

router.post('/log-call', logCall);
router.get('/today', getTodayAnalyticsForAll);
router.get('/:salesperson', getAnalyticsBySalesperson);

export default router;
