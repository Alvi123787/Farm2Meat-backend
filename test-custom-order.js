
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import customOrderRoutes from './routes/customOrderRoutes.js';
import connectDB from './utils/db.js';

const app = express();
const PORT = 5001;

app.use(cors());
app.use(express.urlencoded({ extended: true }));

app.use('/api/custom-orders', customOrderRoutes);

// Test the endpoint
app.listen(PORT, async () => {
  console.log(`Test server running on port ${PORT}`);
  await connectDB();
  console.log('Database connected');
  console.log('Now use Postman/curl to test POST /api/custom-orders');
});
