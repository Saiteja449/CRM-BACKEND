import express from 'express';
import { 
  getLeads, 
  createLead, 
  updateLead, 
  deleteLead,
  receiveWebsiteLead
} from '../controllers/leadController.js';

const router = express.Router();

router.route('/')
  .get(getLeads)
  .post(createLead);

// Website form submission endpoint
router.post('/website', receiveWebsiteLead);

router.route('/:id')
  .put(updateLead)
  .delete(deleteLead);

export default router;
