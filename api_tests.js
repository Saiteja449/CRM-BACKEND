// api_tests.js
// Tests for the CRM backend API

const API_URL = 'http://127.0.0.1:5000/api';
let createdLeadId = null;
let createdUserId = null;

async function runTests() {
  console.log('--- Starting CRM API Tests ---\n');

  try {
    // ----------------------------------------------------
    // Scenario 1: Adding a Lead
    // ----------------------------------------------------
    console.log('Test 1: Adding a Lead');
    const randomPhone = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    const newLead = {
      name: 'Test Lead',
      phone: randomPhone,
      email: 'testlead@example.com',
      service: 'Dog Walking',
      status: 'New'
    };
    
    let res = await fetch(`${API_URL}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLead)
    });
    
    let data = await res.json();
    if (res.ok) {
      console.log('✅ Lead created successfully!');
      console.log('Lead data:', data);
      createdLeadId = data._id || data.id;
    } else {
      console.log('❌ Failed to create lead:', data);
    }
    console.log('');

    // ----------------------------------------------------
    // Scenario 2: Updating the Status of a Lead
    // ----------------------------------------------------
    console.log('Test 2: Updating the Status of the Lead');
    if (createdLeadId) {
      const updateData = { status: 'Follow Up' };
      res = await fetch(`${API_URL}/leads/${createdLeadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });
      
      data = await res.json();
      if (res.ok && data.status === 'Follow Up') {
        console.log('✅ Lead status updated successfully to:', data.status);
      } else {
        console.log('❌ Failed to update lead status:', data);
      }
    } else {
      console.log('⚠️ Skipping Test 2 because Lead creation failed.');
    }
    console.log('');

    // ----------------------------------------------------
    // Scenario 3: Adding an Employee
    // ----------------------------------------------------
    console.log('Test 3: Adding an Employee (User)');
    // Use a random email to avoid duplication errors on multiple runs
    const randomNum = Math.floor(Math.random() * 10000);
    const newEmployee = {
      name: 'Test Employee ' + randomNum,
      email: `employee${randomNum}@petsfolio.com`
    };

    res = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newEmployee)
    });
    
    data = await res.json();
    if (res.ok) {
      console.log('✅ Employee created successfully!');
      console.log(`   Name: ${data.name}, Email: ${data.email}, Role: ${data.role}`);
      createdUserId = data._id;
    } else {
      console.log('❌ Failed to create employee:', data);
    }
    console.log('');

    console.log('--- All tests finished! ---');
  } catch (error) {
    console.error('An error occurred during testing:', error);
  }
}

runTests();
