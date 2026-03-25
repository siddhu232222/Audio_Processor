import requests
import sys
import os
import tempfile
import wave
import numpy as np
from datetime import datetime
import json
import base64

class AudioProcessorAPITester:
    def __init__(self, base_url="https://audio-cleaner-22.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api"
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
        else:
            print(f"❌ {name} - FAILED: {details}")
        
        self.test_results.append({
            "test": name,
            "success": success,
            "details": details
        })

    def create_test_audio_file(self, duration=2, sample_rate=44100, frequency=440):
        """Create a test WAV file"""
        # Generate sine wave
        t = np.linspace(0, duration, int(sample_rate * duration), False)
        audio_data = np.sin(2 * np.pi * frequency * t)
        
        # Convert to 16-bit PCM
        audio_data = (audio_data * 32767).astype(np.int16)
        
        # Create temporary file
        temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        
        # Write WAV file
        with wave.open(temp_file.name, 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(audio_data.tobytes())
        
        return temp_file.name

    def test_root_endpoint(self):
        """Test the root API endpoint"""
        try:
            response = requests.get(f"{self.api_url}/", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if "message" in data and "Audio Processing API" in data["message"]:
                    self.log_test("Root endpoint (/api/)", True)
                    return True
                else:
                    self.log_test("Root endpoint (/api/)", False, f"Unexpected response: {data}")
                    return False
            else:
                self.log_test("Root endpoint (/api/)", False, f"Status code: {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("Root endpoint (/api/)", False, f"Exception: {str(e)}")
            return False

    def test_audio_process_endpoint(self):
        """Test the audio processing endpoint"""
        try:
            # Create test audio file
            test_file_path = self.create_test_audio_file(duration=3, frequency=1000)
            
            try:
                with open(test_file_path, 'rb') as audio_file:
                    files = {'file': ('test_audio.wav', audio_file, 'audio/wav')}
                    response = requests.post(f"{self.api_url}/audio/process", files=files, timeout=30)
                
                if response.status_code == 200:
                    data = response.json()
                    
                    # Check required fields
                    required_fields = [
                        'id', 'original_sample_rate', 'processed_sample_rate',
                        'processed_audio_base64', 'spectrogram_data',
                        'spectrogram_frequencies', 'spectrogram_times', 'duration'
                    ]
                    
                    missing_fields = [field for field in required_fields if field not in data]
                    
                    if not missing_fields:
                        # Validate data types and content
                        if (isinstance(data['processed_audio_base64'], str) and
                            isinstance(data['spectrogram_data'], list) and
                            isinstance(data['spectrogram_frequencies'], list) and
                            isinstance(data['spectrogram_times'], list) and
                            data['processed_sample_rate'] == 8000):
                            
                            # Try to decode base64 audio
                            try:
                                audio_bytes = base64.b64decode(data['processed_audio_base64'])
                                self.log_test("Audio processing endpoint", True, 
                                            f"Processed {data['duration']:.2f}s audio to 8KHz")
                                return True
                            except Exception as decode_error:
                                self.log_test("Audio processing endpoint", False, 
                                            f"Invalid base64 audio: {str(decode_error)}")
                                return False
                        else:
                            self.log_test("Audio processing endpoint", False, 
                                        "Invalid data types or sample rate not 8000")
                            return False
                    else:
                        self.log_test("Audio processing endpoint", False, 
                                    f"Missing fields: {missing_fields}")
                        return False
                else:
                    self.log_test("Audio processing endpoint", False, 
                                f"Status code: {response.status_code}, Response: {response.text}")
                    return False
                    
            finally:
                # Clean up test file
                os.unlink(test_file_path)
                
        except Exception as e:
            self.log_test("Audio processing endpoint", False, f"Exception: {str(e)}")
            return False

    def test_audio_transcribe_endpoint(self):
        """Test the audio transcription endpoint"""
        try:
            # Create test audio file (longer for better transcription)
            test_file_path = self.create_test_audio_file(duration=5, frequency=800)
            
            try:
                with open(test_file_path, 'rb') as audio_file:
                    files = {'file': ('test_audio.wav', audio_file, 'audio/wav')}
                    response = requests.post(f"{self.api_url}/audio/transcribe", files=files, timeout=45)
                
                if response.status_code == 200:
                    data = response.json()
                    
                    # Check required fields
                    required_fields = ['id', 'transcription']
                    missing_fields = [field for field in required_fields if field not in data]
                    
                    if not missing_fields:
                        if isinstance(data['transcription'], str):
                            self.log_test("Audio transcription endpoint", True, 
                                        f"Transcription length: {len(data['transcription'])} chars")
                            return True
                        else:
                            self.log_test("Audio transcription endpoint", False, 
                                        "Transcription is not a string")
                            return False
                    else:
                        self.log_test("Audio transcription endpoint", False, 
                                    f"Missing fields: {missing_fields}")
                        return False
                else:
                    self.log_test("Audio transcription endpoint", False, 
                                f"Status code: {response.status_code}, Response: {response.text}")
                    return False
                    
            finally:
                # Clean up test file
                os.unlink(test_file_path)
                
        except Exception as e:
            self.log_test("Audio transcription endpoint", False, f"Exception: {str(e)}")
            return False

    def test_status_endpoints(self):
        """Test status check endpoints"""
        try:
            # Test POST status
            test_data = {"client_name": f"test_client_{datetime.now().strftime('%H%M%S')}"}
            response = requests.post(f"{self.api_url}/status", json=test_data, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if 'id' in data and 'client_name' in data and 'timestamp' in data:
                    self.log_test("POST /api/status", True)
                    
                    # Test GET status
                    get_response = requests.get(f"{self.api_url}/status", timeout=10)
                    if get_response.status_code == 200:
                        get_data = get_response.json()
                        if isinstance(get_data, list):
                            self.log_test("GET /api/status", True, f"Retrieved {len(get_data)} status checks")
                            return True
                        else:
                            self.log_test("GET /api/status", False, "Response is not a list")
                            return False
                    else:
                        self.log_test("GET /api/status", False, f"Status code: {get_response.status_code}")
                        return False
                else:
                    self.log_test("POST /api/status", False, "Missing required fields in response")
                    return False
            else:
                self.log_test("POST /api/status", False, f"Status code: {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("Status endpoints", False, f"Exception: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all backend API tests"""
        print("🚀 Starting Audio Processor API Tests")
        print(f"📍 Testing against: {self.base_url}")
        print("=" * 60)
        
        # Test basic connectivity first
        self.test_root_endpoint()
        
        # Test status endpoints
        self.test_status_endpoints()
        
        # Test core audio processing functionality
        self.test_audio_process_endpoint()
        
        # Test transcription functionality
        self.test_audio_transcribe_endpoint()
        
        print("=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} tests passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return True
        else:
            print("⚠️  Some tests failed. Check the details above.")
            return False

def main():
    tester = AudioProcessorAPITester()
    success = tester.run_all_tests()
    
    # Save detailed results
    results = {
        "timestamp": datetime.now().isoformat(),
        "total_tests": tester.tests_run,
        "passed_tests": tester.tests_passed,
        "success_rate": (tester.tests_passed / tester.tests_run * 100) if tester.tests_run > 0 else 0,
        "test_details": tester.test_results
    }
    
    with open("/app/backend_test_results.json", "w") as f:
        json.dump(results, f, indent=2)
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())