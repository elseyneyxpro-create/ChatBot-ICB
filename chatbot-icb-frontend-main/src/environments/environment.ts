export const environment = {
  production: false,
  // 👇 CAMBIO CLAVE: Usamos 'localhost' en lugar de '127.0.0.1'
  API_URL: 'http://localhost:3000', 
  auth: {
    // También lo cambiamos aquí para ser consistentes
    loginUrl: 'http://localhost:3000/auth/google',
  },
};