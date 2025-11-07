const request = require('supertest');
const app = require('../index'); // или твой главный файл

describe('Magic Worker API', () => {
  test('GET / should return service status', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('message');
    expect(response.body).toHaveProperty('status');
  });

  test('GET /api/stats should return system stats', async () => {
    const response = await request(app).get('/api/stats');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
    expect(response.body).toHaveProperty('stats');
  });
});