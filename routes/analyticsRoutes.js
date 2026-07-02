import express from 'express';
import { logCall, getAnalyticsBySalesperson } from '../controllers/analyticsController.js';

const router = express.Router();

router.post('/log-call', logCall);
router.get('/:salesperson', getAnalyticsBySalesperson);

export default router;
