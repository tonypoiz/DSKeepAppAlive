// @param: text | targetBundleID | Target Bundle ID | com.g8row.photosbackup
// @param: switch | keepAliveEnabled | Keep target app alive | true

(() => {
  const assertionStorageKeyText = "appkeepalive.runningboard.assertion";
  const targetStorageKeyText = "appkeepalive.runningboard.target";

  const isObject = (value) => value && r_is_objc_ptr(value);
  const release = (value) => {
    if (isObject(value)) r_msg2(value, "release");
  };
  const readTextParameter = (globalValue, key) => {
    if (typeof globalValue !== "undefined") return String(globalValue).trim();
    return String(r_pref_str(key) || "").trim();
  };
  const readBooleanParameter = (globalValue, key) => {
    if (typeof globalValue !== "undefined") return Boolean(globalValue);
    return Boolean(r_pref_bool(key));
  };

  const configuredBundleID = readTextParameter(
    typeof targetBundleID !== "undefined" ? targetBundleID : undefined,
    "targetBundleID"
  );
  const shouldEnable = readBooleanParameter(
    typeof keepAliveEnabled !== "undefined" ? keepAliveEnabled : undefined,
    "keepAliveEnabled"
  );

  const frameworkPath = r_nsstr(
    "/System/Library/PrivateFrameworks/RunningBoardServices.framework"
  );
  const frameworkBundle = r_msg2(
    r_class("NSBundle"),
    "bundleWithPath:",
    frameworkPath
  );
  if (isObject(frameworkBundle)) r_msg2(frameworkBundle, "load");
  release(frameworkPath);

  // SpringBoard owns the retained assertion. This keeps it independent of the
  // JavaScript context, while a later run can always retrieve and invalidate it.
  const mainThread = r_msg2_main(r_class("NSThread"), "mainThread");
  const store = isObject(mainThread)
    ? r_msg2_main(mainThread, "threadDictionary")
    : "0x0";
  const assertionStorageKey = r_nsstr(assertionStorageKeyText);
  const targetStorageKey = r_nsstr(targetStorageKeyText);

  if (!isObject(store) || !isObject(assertionStorageKey) || !isObject(targetStorageKey)) {
    log("App KeepAlive: unable to access SpringBoard storage; nothing changed.");
    release(assertionStorageKey);
    release(targetStorageKey);
    return;
  }

  // Every run first tears down the previous target. Changing the Bundle ID is
  // therefore safe and only one app can be held at a time.
  const previous = r_msg2_main(store, "objectForKey:", assertionStorageKey);
  const hadPreviousAssertion = isObject(previous);
  if (hadPreviousAssertion && r_responds(previous, "invalidate")) {
    r_msg2_main(previous, "invalidate");
  }
  r_msg2_main(store, "removeObjectForKey:", assertionStorageKey);
  r_msg2_main(store, "removeObjectForKey:", targetStorageKey);

  if (!shouldEnable) {
    log(
      hadPreviousAssertion
        ? "App KeepAlive: OFF. Previous assertion released; it is now safe to disable or uninstall the tweak."
        : "App KeepAlive: OFF. No assertion was active; it is safe to disable or uninstall the tweak."
    );
    release(assertionStorageKey);
    release(targetStorageKey);
    return;
  }

  if (!configuredBundleID) {
    log("App KeepAlive: enter a Bundle ID, open that app, then run the tweak again.");
    release(assertionStorageKey);
    release(targetStorageKey);
    return;
  }

  if (configuredBundleID.toLowerCase() === "com.apple.springboard") {
    log("App KeepAlive: SpringBoard is not an allowed target.");
    release(assertionStorageKey);
    release(targetStorageKey);
    return;
  }

  const predicateClass = r_class("RBSProcessPredicate");
  const handleClass = r_class("RBSProcessHandle");
  const targetClass = r_class("RBSTarget");
  const attributeClass = r_class("RBSDomainAttribute");
  const assertionClass = r_class("RBSAssertion");
  if (!predicateClass || !handleClass || !targetClass || !attributeClass || !assertionClass) {
    log("App KeepAlive: required RunningBoard classes are unavailable on this iOS build.");
    release(assertionStorageKey);
    release(targetStorageKey);
    return;
  }

  const bundleIDString = r_nsstr(configuredBundleID);
  const predicate = r_msg2(
    predicateClass,
    "predicateMatchingBundleIdentifier:",
    bundleIDString
  );
  const handle = isObject(predicate)
    ? r_msg2(handleClass, "handleForPredicate:error:", predicate, 0)
    : "0x0";
  const handleValid = isObject(handle) && (
    !r_responds(handle, "isValid") || Number(r_msg2(handle, "isValid")) !== 0
  );
  const pid = handleValid ? r_msg2(handle, "pid") : "0x0";

  if (!handleValid || Number(pid) <= 0) {
    log(
      "App KeepAlive: no running process found for " + configuredBundleID
      + ". Open the app first, then run the tweak again."
    );
    release(bundleIDString);
    release(assertionStorageKey);
    release(targetStorageKey);
    return;
  }

  const target = r_msg2(targetClass, "targetWithPid:", pid);
  const domain = r_nsstr("com.apple.frontboard");
  const attributeName = r_nsstr("Workspace-BackgroundActive");
  const attribute = r_msg2(
    attributeClass,
    "attributeWithDomain:name:",
    domain,
    attributeName
  );
  const attributes = isObject(attribute)
    ? r_msg2(r_class("NSArray"), "arrayWithObject:", attribute)
    : "0x0";
  const explanation = r_nsstr("App KeepAlive: " + configuredBundleID);
  const allocated = isObject(target) && isObject(attributes)
    ? r_msg2(assertionClass, "alloc")
    : "0x0";
  const assertion = isObject(allocated)
    ? r_msg2(
        allocated,
        "initWithExplanation:target:attributes:",
        explanation,
        target,
        attributes
      )
    : "0x0";

  release(domain);
  release(attributeName);
  release(explanation);

  if (!isObject(assertion)) {
    log("App KeepAlive: could not construct the RunningBoard assertion.");
    release(bundleIDString);
    release(assertionStorageKey);
    release(targetStorageKey);
    return;
  }

  // NSError** may be nil. This returns synchronously after runningboardd has
  // accepted or rejected Workspace-BackgroundActive.
  const acquired = Number(r_msg2(assertion, "acquireWithError:", 0)) !== 0;
  const assertionValid = acquired && (
    !r_responds(assertion, "isValid") || Number(r_msg2(assertion, "isValid")) !== 0
  );

  if (!assertionValid) {
    log(
      "App KeepAlive: RunningBoard refused Workspace-BackgroundActive for "
      + configuredBundleID + "."
    );
    release(assertion);
    release(bundleIDString);
    release(assertionStorageKey);
    release(targetStorageKey);
    return;
  }

  r_msg2_main(store, "setObject:forKey:", assertion, assertionStorageKey);
  r_msg2_main(store, "setObject:forKey:", bundleIDString, targetStorageKey);
  release(assertion);
  release(bundleIDString);

  log(
    "App KeepAlive: ON for " + configuredBundleID
    + " via RunningBoard (pid=" + Number(pid) + ")."
  );
  log("App KeepAlive: do not force-quit the target app. To stop, set Keep target app alive to OFF and re-run this tweak.");

  release(assertionStorageKey);
  release(targetStorageKey);
})();
