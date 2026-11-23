import { Route, Routes } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { HomePage } from './pages/HomePage';
import { SimulationPage } from './pages/SimulationPage';

export default function App() {
  return (
    <div className="min-h-screen bg-[#060911] text-slate-100">
      <Navbar />
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sim/:id" element={<SimulationPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </main>
    </div>
  );
}
