/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                judoBlue: '#005b96', // Custom Judo Blue if needed, or stick to standard blue-600
            }
        },
    },
    plugins: [],
}
