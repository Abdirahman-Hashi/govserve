/** Valid form answers and required documents per pilot service, shared by integration suites. */
export type Service = 'PROOF_OF_ADDRESS' | 'POLICE_CLEARANCE' | 'BIRTH_CERTIFICATE';

export const ANSWERS: Record<Service, Record<string, unknown>> = {
  PROOF_OF_ADDRESS: {
    fullName: 'Amina Hassan Warsame',
    dateOfBirth: '1990-04-12',
    idNumber: 'SO7654321',
    phone: '+252 61 234 5678',
    email: 'amina@example.com',
    district: 'Hodan',
    neighbourhood: 'Taleex',
    streetOrLandmark: 'Near the Taleex junction',
    yearsAtAddress: 4,
    tenure: 'RENT',
  },
  POLICE_CLEARANCE: {
    fullName: 'Amina Hassan Warsame',
    dateOfBirth: '1990-04-12',
    placeOfBirth: 'Mogadishu',
    idNumber: 'SO1234567',
    mothersFullName: 'Halima Yusuf',
    currentAddress: 'Hodan district, near the market',
    purpose: 'EMPLOYMENT',
  },
  BIRTH_CERTIFICATE: {
    relationship: 'MOTHER',
    subjectFullName: 'Hodan Ali Warsame',
    sex: 'FEMALE',
    dateOfBirth: '2019-05-01',
    birthDistrict: 'Hodan',
    placeOfBirthType: 'HOME',
    fatherFullName: 'Ali Warsame',
    motherFullName: 'Amina Hassan',
  },
};
export const DOCS: Record<Service, [string, 'pdf' | 'jpeg'][]> = {
  PROOF_OF_ADDRESS: [
    ['NATIONAL_ID_OR_PASSPORT', 'pdf'],
    ['UTILITY_BILL', 'pdf'],
  ],
  POLICE_CLEARANCE: [
    ['NATIONAL_ID_OR_PASSPORT', 'pdf'],
    ['PASSPORT_PHOTO', 'jpeg'],
  ],
  BIRTH_CERTIFICATE: [['APPLICANT_ID', 'pdf']],
};
