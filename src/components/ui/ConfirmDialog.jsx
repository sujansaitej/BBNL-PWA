import { TicketIcon } from '@heroicons/react/24/outline'
export default function ConfirmDialog({ open, message, onConfirm, onCancel }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50 duration-300">
      <div className="bg-white rounded-2xl shadow-lg p-6 w-80 animate-fadeIn">
        <div className='flex justify-center mb-2'>
          <TicketIcon className="h-12 w-12 text-indigo-700 dark:text-indigo-500" />
        </div>
        <h2 className="text-md text-gray-800 dark:text-gray-500 mb-4 text-center">
          {message}
        </h2>
        <div className="flex justify-center gap-4">
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
          >
            Yes
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition"
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}