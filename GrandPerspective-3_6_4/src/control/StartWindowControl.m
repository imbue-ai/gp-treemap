/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "StartWindowControl.h"

#import "NSURL.h"
#import "RecentDocumentTableCellView.h"
#import "LocalizableStrings.h"
#import "ControlConstants.h"
#import "PreferencesPanelControl.h"

NSString*  TaglineTable = @"Taglines";
NSString*  NumTaglines = @"num-taglines";
NSString*  TaglineFormat = @"tagline-%d";

NSString*  fdaPreferencesUrl =
  @"x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

NSString*  checkFdaPermissionsPath = @"~/Library/Safari";

@interface StartWindowControl (PrivateMethods)

- (void) setTagLineField;
- (void) startScan:(NSInteger)selectedRow sender:(id)sender;

@property (nonatomic, readonly) NSString *appVersionString;

- (BOOL) restoreAccessPermission;
- (void) performStartupChecks;
- (void) performFdaCheck;

- (void) promptForRootDriveSelection;
- (void) showDriveAccessAlert;

- (void) showFdaAlert;
- (void) showSuccessAlert;
- (BOOL) hasFdaPermissions;
- (void) storeRootVolumeBookmark:(NSURL *)url;

- (BOOL) suppressFdaWarningsEnabled;
- (void) handleSuppressFdaWarningsButton:(id)sender;

- (void) handleEditFdaPreferences;

@end // @interface StartWindowControl (PrivateMethods)

@implementation StartWindowControl {
    BOOL _driveAccessActive;
}

- (instancetype) initWithMainMenuControl:(MainMenuControl *)mainMenuControlVal {
  if (self = [super initWithWindow: nil]) {
    mainMenuControl = [mainMenuControlVal retain];

    numTagLines = [NSBundle.mainBundle localizedStringForKey: NumTaglines
                                                       value: @"1"
                                                       table: TaglineTable].intValue;

    // Show a random tagline
    tagLineIndex = arc4random_uniform(numTagLines);

    forceReloadOnShow = NO;
  }
  return self;
}

- (void) dealloc {
  NSLog(@"StartWindowControl.dealloc");
  [mainMenuControl release];

  [super dealloc];
}

- (NSString *)windowNibName {
  return @"StartWindow";
}

- (void)windowDidLoad {
  [super windowDidLoad];

  recentScansView.delegate = self;
  recentScansView.dataSource = self;
  recentScansView.doubleAction = @selector(scanActionAfterDoubleClick:);

  [recentScansView registerForDraggedTypes: NSURL.supportedPasteboardTypes];
  [recentScansView sizeLastColumnToFit];

  [self setTagLineField];

  // Initiate the two-step verification process
  [self performStartupChecks];
}


//----------------------------------------------------------------------------
// NSTableSource

- (NSInteger) numberOfRowsInTableView:(NSTableView *)tableView {
  return NSDocumentController.sharedDocumentController.recentDocumentURLs.count + 1;
}

- (NSView *)tableView:(NSTableView *)tableView
   viewForTableColumn:(NSTableColumn *)tableColumn
                  row:(NSInteger)row {

  RecentDocumentTableCellView *cellView = [tableView makeViewWithIdentifier: @"RecentScanView"
                                                                      owner: self];

  NSInteger  numRecent = NSDocumentController.sharedDocumentController.recentDocumentURLs.count;

  if (row < numRecent) {
    NSURL *docUrl = NSDocumentController.sharedDocumentController.recentDocumentURLs[row];

    cellView.textField.stringValue =
      [NSFileManager.defaultManager displayNameAtPath: docUrl.path];
    cellView.imageView.image = [NSWorkspace.sharedWorkspace iconForFile: docUrl.path];
    cellView.secondTextField.stringValue = docUrl.path;
  } else {
    NSString  *msg = ((numRecent > 0) ?
                      NSLocalizedString(@"Scan Other Folder",
                                        @"Entry in Start window, alongside other options") :
                      NSLocalizedString(@"Scan Folder", @"Solitairy entry in Start window"));

    cellView.textField.stringValue = msg;
    cellView.secondTextField.stringValue = LocalizationNotNeeded(@"...");
  }

  return cellView;
}

- (NSDragOperation) tableView:(NSTableView *)tableView
                 validateDrop:(id <NSDraggingInfo>)info
                  proposedRow:(NSInteger)row
        proposedDropOperation:(NSTableViewDropOperation)op {

  NSURL *filePathURL = [NSURL getFileURLFromPasteboard: info.draggingPasteboard];
  //NSLog(@"Drop request with %@", filePathURL);

  if (filePathURL.isDirectory) {
    return NSDragOperationGeneric;
  }

  return NSDragOperationNone;
}

- (BOOL) tableView:(NSTableView *)tableView
        acceptDrop:(id <NSDraggingInfo>)info
               row:(NSInteger)row
     dropOperation:(NSTableViewDropOperation)op {

  NSURL *filePathURL = [NSURL getFileURLFromPasteboard: info.draggingPasteboard];
  //NSLog(@"Accepting drop request with %@", filePathURL);

  [mainMenuControl scanFolder: filePathURL.path];

  return YES;
}

//----------------------------------------------------------------------------

- (IBAction) scanActionAfterDoubleClick:(id)sender {
  [self startScan: recentScansView.clickedRow sender: sender];
}

- (IBAction) scanAction:(id)sender {
  [self startScan: recentScansView.selectedRow sender: sender];
}

- (IBAction) clearRecentScans:(id)sender {
  [NSDocumentController.sharedDocumentController clearRecentDocuments: sender];

  [recentScansView reloadData];
  clearHistoryButton.enabled = false;
}

- (IBAction) helpAction:(id)sender {
  [self.window close];

  [NSApplication.sharedApplication showHelp: sender];
}

- (void) cancelOperation:(id)sender {
  [self.window close];
}

- (void) showWindow:(id)sender {
  // Except when the window is first shown, always reload the data as the number and order of recent
  // documents may have changed.
  if (forceReloadOnShow) {
    [recentScansView reloadData];
  } else {
    forceReloadOnShow = YES;
  }

  clearHistoryButton.enabled =
    NSDocumentController.sharedDocumentController.recentDocumentURLs.count > 0;

  [super showWindow: sender];
}

// Invoked because the controller is the delegate for the window.
- (void) windowWillClose:(NSNotification *)notification {
  [NSApp stopModal];
}

- (void) changeTagLine {
  tagLineIndex = (tagLineIndex + 1) % numTagLines;
  [self setTagLineField];
}

@end


@implementation StartWindowControl (PrivateMethods)

- (void) setTagLineField {
  NSString  *tagLineKey = [NSString stringWithFormat: TaglineFormat, tagLineIndex + 1];
  NSString  *localizedTagLine = [NSBundle.mainBundle localizedStringForKey: tagLineKey
                                                                     value: nil
                                                                     table: TaglineTable];
  // Nil-check to avoid problems if tag lines are not properly localized
  if (localizedTagLine != nil) {
    tagLine.stringValue = localizedTagLine;
  }
}

- (void) startScan:(NSInteger)selectedRow sender:(id)sender {
  [self.window close];

  NSDocumentController  *controller = NSDocumentController.sharedDocumentController;

  if (selectedRow >= 0 && selectedRow < controller.recentDocumentURLs.count) {
    // Scan selected folder
    NSURL *docUrl = controller.recentDocumentURLs[selectedRow];

    [mainMenuControl scanFolder: docUrl.path];
  } else {
    // Let user select the folder to scan
    [mainMenuControl scanDirectoryView: sender];
  }
}

- (NSString *)appVersionString {
  return [NSBundle.mainBundle objectForInfoDictionaryKey: @"CFBundleShortVersionString"];
}

- (BOOL) restoreAccessPermission {
  NSData *bookmarkData = [NSUserDefaults.standardUserDefaults objectForKey: RootVolumeBookmarkKey];
  if (!bookmarkData) {
    NSLog(@"No bookmark found for root volume");
    return NO;
  }

  NSError *error = nil;
  BOOL isStale = NO;
  NSURL *allowedUrl = [NSURL URLByResolvingBookmarkData: bookmarkData
                                                options: NSURLBookmarkResolutionWithSecurityScope
                                          relativeToURL: nil
                                    bookmarkDataIsStale: &isStale
                                                  error: &error];

  if (isStale) {
    NSLog(@"Replacing stale root volume bookmark");
    [self storeRootVolumeBookmark: allowedUrl];
  }

  if (!allowedUrl) {
    NSLog(@"Failed to resolve URL from bookmark: %@", error);
    return NO;
  }
  if (![allowedUrl startAccessingSecurityScopedResource]) {
    NSLog(@"Failed to restore access to: %@", allowedUrl.path);
    return NO;
  }

  NSLog(@"Restored access to: %@", allowedUrl.path);
  NSLog(@"If this is not your root volume, you should reset the bookmark using: defaults delete net.sourceforge.grandperspectiv %@",
        RootVolumeBookmarkKey);

  return YES;
}

- (void) performStartupChecks {
  // Try to obtain access to root volume
  if ([self restoreAccessPermission]) {
    NSLog(@"Obtained access to root volume");
    [self performFdaCheck];
  } else {
    // Could not restore previous access, so prompt for permission
    [self showDriveAccessAlert];
  }
}

- (void) performFdaCheck {
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;

  // Check if we have Full Disk Access (Privacy)
  if ([self hasFdaPermissions]) {
    NSLog(@"Verified FDA permissions");
    if (![userDefaults boolForKey: SuppressFdaSuccessKey]) {
      [self showSuccessAlert];
      [userDefaults setBool: YES forKey: SuppressFdaSuccessKey];
    }
  } else {
    NSLog(@"FDA permission check failed");

    [userDefaults setBool: NO forKey: SuppressFdaSuccessKey];

    if (![self suppressFdaWarningsEnabled]) {
      [self showFdaAlert];
    }
  }
}

- (void) promptForRootDriveSelection {
  NSOpenPanel *openPanel = [NSOpenPanel openPanel];
  [openPanel setCanChooseFiles: NO];
  [openPanel setCanChooseDirectories: YES];
  [openPanel setAllowsMultipleSelection: NO];
  [openPanel setPrompt: NSLocalizedString(@"Select Drive", @"Button of Open panel")];
  [openPanel setMessage: NSLocalizedString(@"Select your main drive (e.g. Macintosh HD)",
                                           @"Open panel message")];

  // Set directory to /Volumes so the user sees the list of drives
  [openPanel setDirectoryURL: [NSURL fileURLWithPath: @"/Volumes"]];

  [openPanel beginSheetModalForWindow: self.window completionHandler: ^(NSInteger result) {
    if (result == NSModalResponseOK) {
      NSURL *selectedUrl = openPanel.URL;
      [self storeRootVolumeBookmark: selectedUrl];

      if ([selectedUrl startAccessingSecurityScopedResource]) {
        [self performFdaCheck];
      } else {
        NSLog(@"Failed to access security scoped resource for: %@", selectedUrl.path);
      }
    }
  }];
}

- (void) showDriveAccessAlert {
  NSAlert *alert = [[[NSAlert alloc] init] autorelease];
  [alert addButtonWithTitle: CONTINUE_BUTTON_TITLE];
  [alert addButtonWithTitle: CANCEL_BUTTON_TITLE];

  alert.messageText = NSLocalizedString(@"Disk access required", @"FDA warning sheet");

  alert.informativeText = NSLocalizedString
    (@"GrandPerspective needs full access to your disk for optimal scan performance. Please select your main volume (e.g. Macintosh HD) in the following prompt.",
     @"FDA warning sheet");

  [alert beginSheetModalForWindow: self.window completionHandler: ^(NSModalResponse returnCode) {
    if (returnCode == NSAlertFirstButtonReturn) {
      [self promptForRootDriveSelection];
    }
  }];
}

- (void) showFdaAlert {
  NSAlert *alert = [[[NSAlert alloc] init] autorelease];

  // Options: Fix it, or Continue anyway
  [alert addButtonWithTitle: NSLocalizedString(@"Edit System Preferences", @"FDA warning alert")];
  [alert addButtonWithTitle: CONTINUE_BUTTON_TITLE];

  alert.messageText = NSLocalizedString
    (@"GrandPerspective seems to lack Full Disk Access permissions",
    @"FDA warning alert");

  alert.informativeText = NSLocalizedString
    (@"This may limit the disk content it can see. To remedy this, you can grant the permissions via the System Preferences.",
     @"FDA warning alert");

  alert.showsSuppressionButton = YES;
  alert.suppressionButton.target = self;
  alert.suppressionButton.action = @selector(handleSuppressFdaWarningsButton:);
  alert.suppressionButton.title = NSLocalizedString(@"Do not show again", @"FDA warning alert");
  alert.suppressionButton.state = ([self suppressFdaWarningsEnabled]
                                   ? NSControlStateValueOn : NSControlStateValueOff);

  [alert beginSheetModalForWindow: self.window completionHandler: ^(NSModalResponse returnCode) {
    if (returnCode == NSAlertFirstButtonReturn) {
      [self handleEditFdaPreferences];
    }
  }];
}

- (void) showSuccessAlert {
  NSAlert *alert = [[[NSAlert alloc] init] autorelease];
  alert.messageText = NSLocalizedString(@"Permission setup complete", @"FDA success alert");
  alert.informativeText = NSLocalizedString(@"Full Disk Access is verified.", @"FDA success alert");

  [alert beginSheetModalForWindow: self.window completionHandler: nil];
}

- (BOOL) hasFdaPermissions {
  NSString *path = checkFdaPermissionsPath.stringByExpandingTildeInPath;
  NSString *tildeReplacement = [path substringToIndex:
                                path.length - checkFdaPermissionsPath.length + 1];

  NSRange range = [tildeReplacement rangeOfString: @"/Library/Containers"];
  if (range.location != NSNotFound) {
    // Path is sand-boxed. Replace sandbox home path by actual user home.

    NSString *userHome = [tildeReplacement substringToIndex: range.location];
    path = [userHome stringByAppendingPathComponent:
            [checkFdaPermissionsPath substringFromIndex: 2]];
  }

  NSError *error = nil;
  [NSFileManager.defaultManager contentsOfDirectoryAtPath: path error: &error];

  if (error) {
    NSLog(@"FDA permission check using %@ failed, error: %@", path, error);
    return NO;
  }

  NSLog(@"FDA permission check using %@ succeeded", path);
  return YES;
}

- (void) storeRootVolumeBookmark:(NSURL *)url {
  NSError *error = nil;
  NSData *bookmarkData = [url bookmarkDataWithOptions: NSURLBookmarkCreationWithSecurityScope
                       includingResourceValuesForKeys: nil
                                        relativeToURL: nil
                                                error: &error];
  if (bookmarkData) {
    NSLog(@"Stored bookmark for %@", url.path);

    [NSUserDefaults.standardUserDefaults setObject: bookmarkData
                                            forKey: RootVolumeBookmarkKey];
  } else {
    NSLog(@"Failed to create bookmark for %@: %@", url.path, error);
  }
}

- (BOOL) suppressFdaWarningsEnabled {
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  NSString  *suppressVersion = [userDefaults stringForKey: SuppressFdaWarningsKey];

  return [suppressVersion isEqualToString: self.appVersionString];
}

- (void) handleSuppressFdaWarningsButton:(id)sender {
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  if ([sender state] == NSControlStateValueOn) {
    [userDefaults setObject: self.appVersionString forKey: SuppressFdaWarningsKey];
  } else {
    [userDefaults removeObjectForKey: SuppressFdaWarningsKey];
  }
}

- (void) handleEditFdaPreferences {
  NSURL *url = [NSURL URLWithString: fdaPreferencesUrl];
  [NSWorkspace.sharedWorkspace openURL: url];
}

@end // @interface StartWindowControl (PrivateMethods)
