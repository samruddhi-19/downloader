import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// window.TrelloPowerUp.initialize({
//   'board-buttons': function(t) {
//     return [{
//       text: 'Download Attachments',
//       callback: function(t) {
//         return t.modal({
//           url: window.location.href,
//           title: 'Downloader',
//           height: 600,
//         });
//       }
//     }];
//   }
// });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)