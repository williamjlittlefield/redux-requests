import {
  call,
  takeEvery,
  put,
  all,
  cancelled,
  getContext,
  setContext,
} from 'redux-saga/effects';

import { success, error, abort } from './actions';
import {
  REQUEST_INSTANCE,
  REQUESTS_CONFIG,
  INCORRECT_PAYLOAD_ERROR,
} from './constants';

export const voidCallback = () => {};

const isFSA = action => !!action.payload;

export const successAction = (action, data) => ({
  ...(isFSA(action)
    ? {
        payload: {
          data,
        },
      }
    : {
        data,
      }),
  meta: {
    ...action.meta,
    requestAction: action,
  },
});

export const errorAction = (action, errorData) => ({
  ...(isFSA(action)
    ? {
        payload: errorData,
        error: true,
      }
    : {
        error,
      }),
  meta: {
    ...action.meta,
    requestAction: action,
  },
});

export const abortAction = action => ({
  meta: {
    ...action.meta,
    requestAction: action,
  },
});

export const defaultConfig = {
  driver: null,
  success,
  error,
  abort,
  successAction,
  errorAction,
  abortAction,
  onRequest: null,
  onSuccess: null,
  onError: null,
  onAbort: null,
};

export function createRequestInstance(requestInstance, config) {
  return setContext({
    [REQUEST_INSTANCE]: requestInstance,
    [REQUESTS_CONFIG]: { ...defaultConfig, ...config },
  });
}

export function getRequestInstance() {
  return getContext(REQUEST_INSTANCE);
}

export function getRequestsConfig() {
  return getContext(REQUESTS_CONFIG);
}

const getActionPayload = action =>
  action.payload === undefined ? action : action.payload;

export const isRequestAction = action => {
  const actionPayload = getActionPayload(action);
  return actionPayload.request || actionPayload.requests;
};

export const abortRequestIfDefined = abortRequest => {
  if (abortRequest) {
    return call(abortRequest);
  }

  return null;
};

export function* sendRequest(
  action,
  { dispatchRequestAction = false, silent = false } = {},
) {
  if (!isRequestAction(action)) {
    throw new Error(INCORRECT_PAYLOAD_ERROR);
  }

  const requestInstance = yield getRequestInstance();
  const requestsConfig = yield getRequestsConfig();

  if (dispatchRequestAction && !silent) {
    yield put(action);
  }

  const { driver } = requestsConfig;

  const requestHandlers = yield call(
    [driver, 'getRequestHandlers'],
    requestInstance,
    requestsConfig,
  );

  const actionPayload = getActionPayload(action);

  let request = actionPayload.request || actionPayload.requests;

  if (requestsConfig.onRequest && !silent) {
    request = yield call(requestsConfig.onRequest, request, action);
  }

  try {
    let response;
    let responseError;

    try {
      if (actionPayload.request) {
        response = yield call(requestHandlers.sendRequest, request);
      } else {
        response = yield all(
          request.map(requestItem =>
            call(requestHandlers.sendRequest, requestItem),
          ),
        );
      }
    } catch (e) {
      responseError = e;
    }

    if (responseError) {
      if (requestsConfig.onError && !silent) {
        try {
          response = yield call(requestsConfig.onError, responseError, action);
        } catch (e) {
          responseError = e;
        }
      }

      if (!response) {
        const errorPayload = yield call(driver.getErrorPayload, responseError);

        if (!silent) {
          yield put({
            type: requestsConfig.error(action.type),
            ...requestsConfig.errorAction(action, errorPayload),
          });
        }

        return { error: responseError };
      }
    }

    if (requestsConfig.onSuccess && !silent) {
      response = yield call(requestsConfig.onSuccess, response, action);
    }

    const successPayload = yield call(
      driver.getSuccessPayload,
      response,
      request,
    );

    if (!silent) {
      yield put({
        type: requestsConfig.success(action.type),
        ...requestsConfig.successAction(action, successPayload),
      });
    }

    return { response };
  } finally {
    if (yield cancelled()) {
      yield abortRequestIfDefined(requestHandlers.abortRequest);

      if (requestsConfig.onAbort && !silent) {
        yield call(requestsConfig.onAbort, action);
      }

      if (!silent) {
        yield put({
          type: requestsConfig.abort(action.type),
          ...requestsConfig.abortAction(action),
        });
      }
    }
  }
}

export function* watchRequests() {
  yield takeEvery(isRequestAction, sendRequest);
}
