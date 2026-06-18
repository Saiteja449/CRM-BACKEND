import express from 'express';
import { 
  getLeads, 
  createLead, 
  updateLead, 
  deleteLead 
} from '../controllers/leadController.js';

const router = express.Router();

router.route('/')
  .get(getLeads)
  .post(createLead);

router.route('/:id')
  .put(updateLead)
  .delete(deleteLead);

export default router;
