import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './configs/db.js';
import authRoutes from './routes/authRoutes.js';

dotenv.config();

// Connect to database
connectDB();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount routes
app.use('/api/auth', authRoutes);

// Base route
app.get('/', (req, res) => {
  res.send('API is running...');
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
