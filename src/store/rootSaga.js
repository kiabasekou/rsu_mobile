import { all } from 'redux-saga/effects';
import authSaga from './sagas/authSaga';
import surveysSaga from './sagas/surveysSaga';

export default function* rootSaga() {
  yield all([
    authSaga(),
    surveysSaga(),
  ]);
}