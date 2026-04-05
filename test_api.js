import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testAnimal = {
  name: 'Test Bakra',
  breed: 'Beetal',
  weight: '40kg',
  age: '1 Year',
  price: '45,000',
  location: 'RYK',
  status: 'available',
  whatsappMsg: 'Test message'
};

async function testAddAnimal() {
  const form = new FormData();
  for (const key in testAnimal) {
    form.append(key, testAnimal[key]);
  }
  
  // Create a dummy image for testing
  const dummyImagePath = path.join(__dirname, 'dummy.png');
  fs.writeFileSync(dummyImagePath, 'dummy content');
  
  form.append('image', fs.createReadStream(dummyImagePath));

  try {
    const response = await fetch('http://localhost:5000/api/animals', {
      method: 'POST',
      body: form
    });

    const result = await response.json();
    console.log('Result:', result);
    
    if (result.success) {
      console.log('✅ Success! Animal added successfully.');
    } else {
      console.log('❌ Failed:', result.message);
    }
  } catch (error) {
    console.error('Error during test:', error.message);
  } finally {
    if (fs.existsSync(dummyImagePath)) {
      fs.unlinkSync(dummyImagePath);
    }
  }
}

testAddAnimal();