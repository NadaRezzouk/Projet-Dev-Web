// create-owner.js
require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function createOwner() {
  try {
    const name = 'Proprietaire Test';
    const email = 'owner@example.com';
    const plainPassword = 'password123';
    const phone = '+000000000';
    const type = 'owner'; // 'client' ou 'owner'

    const hashed = await bcrypt.hash(plainPassword, 10);

    const [result] = await pool.query(
      'INSERT INTO users (name, email, password, phone, type) VALUES (?, ?, ?, ?, ?)',
      [name, email, hashed, phone, type]
    );

    console.log('Proprietaire created with id =', result.insertId);
    console.log(`Email: ${email}  Password: ${plainPassword}`);
    process.exit(0);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      console.error('Cet email existe déjà en base.');
    } else {
      console.error('Erreur création proprietaire:', err);
    }
    process.exit(1);
  }
}

createOwner();