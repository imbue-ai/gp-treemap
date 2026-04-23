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

#import "FilterTestWindowControl.h"

#import "FileItem.h"

#import "FilterTest.h"

#import "FileItemTest.h"
#import "CompoundAndItemTest.h"
#import "ItemNameTest.h"
#import "ItemPathTest.h"
#import "ItemTypeTest.h"
#import "ItemSizeTest.h"
#import "ItemFlagsTest.h"
#import "SelectiveItemTest.h"

#import "MultiMatchStringTest.h"
#import "StringEqualityTest.h"
#import "StringContainmentTest.h"
#import "StringPrefixTest.h"
#import "StringSuffixTest.h"

#import "UniformType.h"
#import "UniformTypeInventory.h"

#import "ControlConstants.h"
#import "NameValidator.h"


// testTargetPopUp choices
static const NSInteger POPUP_FILES             = 0;
static const NSInteger POPUP_FOLDERS           = 1;
static const NSInteger POPUP_FILES_AND_FOLDERS = 2;

// nameMatchPopUp and pathMatchPopUp choices
static const NSInteger POPUP_STRING_IS          = 0;
static const NSInteger POPUP_STRING_CONTAINS    = 1;
static const NSInteger POPUP_STRING_STARTS_WITH = 2;
static const NSInteger POPUP_STRING_ENDS_WITH   = 3;

// typeMatchPopUp
static const NSInteger POPUP_TYPE_CONFORMS_TO = 0;
static const NSInteger POPUP_TYPE_EQUALS      = 1;

// addTypeTargetButton
static const NSInteger POPUP_ADD_TYPE = 0;

// hardLinkStatusPopUp and packageStatusPopUp
static const NSInteger POPUP_FLAG_IS     = 0;
static const NSInteger POPUP_FLAG_IS_NOT = 1;

// sizeLowerBoundsUnits and sizeUpperBoundsUnits choices
static const NSInteger POPUP_BYTES = 0;
static const NSInteger POPUP_KB __attribute__ ((unused)) = 1;
static const NSInteger POPUP_MB __attribute__ ((unused)) = 2;
static const NSInteger POPUP_GB    = 3;


@interface FilterTestWindowControl (PrivateMethods) 

- (void) resetState;
- (void) updateStateBasedOnTest:(FileItemTest *)test;
- (void) updateStateBasedOnItemNameTest:(ItemNameTest *)test;
- (void) updateStateBasedOnItemPathTest:(ItemPathTest *)test;
- (void) updateStateBasedOnItemTypeTest:(ItemTypeTest *)test;
- (void) updateStateBasedOnItemSizeTest:(ItemSizeTest *)test;
- (void) updateStateBasedOnItemFlagsTest:(ItemFlagsTest *)test;
- (FileItemTest *)updateStateBasedOnSelectiveItemTest:(SelectiveItemTest *)test;

@property (nonatomic, readonly, strong) ItemNameTest *itemNameTestBasedOnState;
@property (nonatomic, readonly, strong) ItemPathTest *itemPathTestBasedOnState;
@property (nonatomic, readonly, strong) ItemTypeTest *itemTypeTestBasedOnState;
@property (nonatomic, readonly, strong) ItemSizeTest *itemSizeTestBasedOnState;
@property (nonatomic, readonly, strong) ItemFlagsTest *itemFlagsTestBasedOnState;
- (FileItemTest *)selectiveItemTestBasedOnState:(FileItemTest *)subTest;

- (IBAction) updateEnabledState:(id)sender;
- (void) updateWindowTitle;

- (BOOL) tryStopFieldEditor;

- (void) textEditingStarted:(NSNotification *)notification;
- (void) textEditingStopped:(NSNotification *)notification;

@property (nonatomic, getter=isNameKnownInvalid, readonly) BOOL nameKnownInvalid;

@end // @interface FilterTestWindowControl (PrivateMethods)


@interface MultiMatchControls : NSObject <NSTableViewDataSource, NSTableViewDelegate> {
  NSPopUpButton  *matchPopUpButton;
  NSTableView  *targetsView;
  NSButton  *addTargetButton;
  NSButton  *removeTargetButton;

  NSMutableArray  *matchTargets;
  BOOL  enabled;
}

// Overrides designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithMatchModePopUpButton:(NSPopUpButton *)popUpButton
                                  targetsView:(NSTableView *)targetsView
                              addTargetButton:(NSButton *)addTargetButton
                           removeTargetButton:(NSButton *)removeTargetButton NS_DESIGNATED_INITIALIZER;

- (void) resetState;

- (void) setEnabled:(BOOL)enabled;

@property (nonatomic, readonly) BOOL hasTargets;
- (void) addTarget;
- (void) removeTarget;

@end


@interface MultiMatchControls (PrivateMethods)

- (void) updateEnabledState;

@end


@interface StringMatchControls : MultiMatchControls {
  NSButton  *caseInsensitiveCheckBox;
  FilterTestWindowControl  *windowControl;
  
  /* Tracks if an edit of a match is in progress. If so, the list of matches should not be
   * manipulated, or the table ends up in an inconsistent state.
   */
  BOOL  editInProgress;
}
 
- (instancetype) initWithMatchModePopUpButton:(NSPopUpButton *)popUpButton
                                  targetsView:(NSTableView *)targetsView
                      caseInsensitiveCheckBox:(NSButton *)caseCheckBox
                              addTargetButton:(NSButton *)addTargetButton
                           removeTargetButton:(NSButton *)removeTargetButton
                                windowControl:(FilterTestWindowControl *)windowControl NS_DESIGNATED_INITIALIZER;

- (void) updateStateBasedOnStringTest:(MultiMatchStringTest *)test;
@property (nonatomic, readonly, strong) MultiMatchStringTest *stringTestBasedOnState;

@end // @interface StringMatchControls


@interface StringMatchControls (PrivateMethods)

- (void) didBeginEditing:(NSNotification *)notification;
- (void) didEndEditing:(NSNotification *)notification;

@end // @interface StringMatchControls (PrivateMethods)


@interface TypeMatchControls : MultiMatchControls {
}

- (void) updateStateBasedOnItemTypeTest:(ItemTypeTest *)test;
@property (nonatomic, readonly, strong) ItemTypeTest *itemTypeTestBasedOnState;

@end


@implementation FilterTestWindowControl

- (instancetype) init {
  if (self = [super initWithWindow: nil]) {
    testName = nil;
    nameValidator = nil;
    invalidName = nil;
  }
  return self;
}


- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];
  
  [nameTestControls release];
  [pathTestControls release];
  [typeTestControls release];
  
  [testName release];
  [nameValidator release];
  [invalidName release];

  [super dealloc];
}


- (NSString *)windowNibName {
  return @"FilterTestWindow";
}

- (void) windowDidLoad {
  nameTestControls =
    [[StringMatchControls alloc] initWithMatchModePopUpButton: nameMatchPopUpButton
                                                  targetsView: nameTargetsView
                                      caseInsensitiveCheckBox: nameCaseInsensitiveCheckBox
                                              addTargetButton: addNameTargetButton
                                           removeTargetButton: removeNameTargetButton
                                                windowControl: self];
  pathTestControls =
    [[StringMatchControls alloc] initWithMatchModePopUpButton: pathMatchPopUpButton
                                                  targetsView: pathTargetsView
                                      caseInsensitiveCheckBox: pathCaseInsensitiveCheckBox
                                              addTargetButton: addPathTargetButton
                                           removeTargetButton: removePathTargetButton
                                                windowControl: self];
  typeTestControls =
    [[TypeMatchControls alloc] initWithMatchModePopUpButton: typeMatchPopUpButton
                                                targetsView: typeTargetsView
                                            addTargetButton: addTypeTargetButton
                                         removeTargetButton: removeTypeTargetButton];

  NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;
  [nc addObserver: self
         selector: @selector(textEditingStarted:)
             name: NSTextDidBeginEditingNotification
           object: nil];
  [nc addObserver: self
         selector: @selector(textEditingStopped:)
             name: NSTextDidEndEditingNotification
           object: nil];

  [self updateEnabledState: nil];
}


- (NSString *)fileItemTestName {
  if (testNameField.enabled) {
    // No fixed "visible" name was set, so get the name from the text field.
    return testNameField.stringValue;
  }
  else {
    // The test name field was showing the test's visible name. Return its original name.
    return testName;
  }
}


- (void) setNameValidator:(NSObject<NameValidator> *)validator {
  if (validator != nameValidator) {
    [nameValidator release];
    nameValidator = [validator retain];
  }
}


// Configures the window to represent the given test.
- (void) representFilterTest:(FilterTest *)filterTest {
  [self resetState];
  
  if (filterTest == nil) {
    // No test specified. Leave window in default state.
    return;
  }
  
  // Remember the original name of the test
  [testName release];
  testName = [filterTest.name retain];
  testNameField.stringValue = testName;
  FileItemTest  *test = filterTest.fileItemTest;
  
  if ([test isKindOfClass: [SelectiveItemTest class]]) {
    // It is a selective test. Update state and continue with its subtest
    
    test = [self updateStateBasedOnSelectiveItemTest: (SelectiveItemTest *)test];
  }
  else {
    [testTargetPopUp selectItemAtIndex: POPUP_FILES_AND_FOLDERS];
  }

  
  if ([test isKindOfClass:[CompoundAndItemTest class]]) {
    // It is a compound test. Iterate over all subtests.
    for (FileItemTest *subTest in [((CompoundAndItemTest *)test).subItemTests objectEnumerator]) {
      [self updateStateBasedOnTest: subTest];
    } 
  }
  else {
    // It is a stand-alone test.
    [self updateStateBasedOnTest: test];
  } 

  [self updateWindowTitle];
  [self updateEnabledState: nil];
}

- (FilterTest *)createFilterTest {
  NSMutableArray  *subTests = [NSMutableArray arrayWithCapacity: 4];
  FileItemTest  *subTest;
  
  subTest = self.itemNameTestBasedOnState;
  if (subTest != nil) {
    [subTests addObject: subTest];
  }
  
  subTest = self.itemPathTestBasedOnState;
  if (subTest != nil) {
    [subTests addObject: subTest];
  }

  subTest = self.itemFlagsTestBasedOnState;
  if (subTest != nil) {
    [subTests addObject: subTest];
  }
  
  if ( testTargetPopUp.indexOfSelectedItem == POPUP_FILES ) {
    // Add any file-only tests
    
    subTest = self.itemSizeTestBasedOnState;
    if (subTest != nil) {
      [subTests addObject: subTest];
    }
    
    subTest = self.itemTypeTestBasedOnState;
    if (subTest != nil) {
      [subTests addObject: subTest];
    }
  }
  
  FileItemTest  *test;
  if (subTests.count == 0) {
    test = nil;
  }
  else if (subTests.count == 1) {
    test = subTests.lastObject;
  }
  else {
    test = [[[CompoundAndItemTest alloc] initWithSubItemTests: subTests] autorelease];
  }
  
  test = [self selectiveItemTestBasedOnState: test];
    
  return [FilterTest filterTestWithName: self.fileItemTestName fileItemTest: test];
}

- (void) setVisibleName:(NSString *)name {
  testNameField.stringValue = name;
  [testNameField setEnabled: NO];
  [self updateWindowTitle];
}


- (void)windowDidBecomeKey:(NSNotification *)notification {
  finalNotificationFired = NO; 
  
  if (invalidName) {
    [self.window makeFirstResponder: testNameField];
  }
}

- (BOOL) windowShouldClose:(id)window {
  return [self tryStopFieldEditor];
}

- (void) windowWillClose:(NSNotification *)notification {
  if ( !finalNotificationFired ) {
    // The window is closing while no "okPerformed" or "cancelPerformed" has been fired yet. This
    // means that the user is closing the window using the window's red close button.
    
    finalNotificationFired = YES;
    [NSNotificationCenter.defaultCenter postNotificationName: ClosePerformedEvent object: self];
  }
}

- (IBAction) cancelAction:(id)sender {
  // Note: The window's Cancel key should have the Escape key as equivalent to ensure that this
  // method also gets invoked when the Escape key is pressed. Otherwise, the Escape key will
  // immediately close the window.

  if ([self tryStopFieldEditor]) {
    finalNotificationFired = YES;
    [NSNotificationCenter.defaultCenter postNotificationName: CancelPerformedEvent object: self];
  }
}

- (IBAction) okAction:(id)sender {
  if ([self tryStopFieldEditor]) {
    // If the field editor was active, it resigned its first responder status, meaning that the
    // window can be closed.

    // Check if the name of the test is okay as well.
    NSString  *errorMsg = [nameValidator checkNameIsValid: self.fileItemTestName];
      
    if (errorMsg != nil) {
      NSAlert *alert = [[[NSAlert alloc] init] autorelease];
  
      [alert addButtonWithTitle: OK_BUTTON_TITLE];
      alert.messageText = errorMsg;
      [alert beginSheetModalForWindow: self.window completionHandler: nil];

      [invalidName release];
      invalidName = [self.fileItemTestName retain];
    }
    else {
      finalNotificationFired = YES;
      [NSNotificationCenter.defaultCenter postNotificationName: OkPerformedEvent object: self];
    }
  }
}


- (IBAction) testNameChanged:(id)sender {
  [self updateWindowTitle];
  [self updateEnabledState: nil];
}

// Auto-corrects the lower/upper bound fields so that they contain a valid numeric value.
- (IBAction) sizeBoundEntered:(id)sender {
  int  value = [sender intValue];
  
  if (value < 0) {
    value = 0;
  }
  
  [sender setIntValue: value];
}


- (IBAction) targetPopUpChanged:(id)sender {
  [self updateEnabledState: sender];
}


- (IBAction) nameCheckBoxChanged:(id)sender {
  [self updateEnabledState: sender];
}

- (IBAction) pathCheckBoxChanged:(id)sender {
  [self updateEnabledState: sender];
}

- (IBAction) hardLinkCheckBoxChanged:(id)sender {
  [self updateEnabledState: sender];
}

- (IBAction) packageCheckBoxChanged:(id)sender {
  [self updateEnabledState: sender];
}

- (IBAction) typeCheckBoxChanged:(id)sender {
  [self updateEnabledState: sender];
}

- (IBAction) lowerBoundCheckBoxChanged:(id)sender {
  [self updateEnabledState: sender];
  
  if ([sender state]==NSControlStateValueOn) {
    [self.window makeFirstResponder: sizeLowerBoundField];
  }
}

- (IBAction) upperBoundCheckBoxChanged:(id)sender {
  [self updateEnabledState: sender];
  
  if ([sender state]==NSControlStateValueOn) {
    [self.window makeFirstResponder: sizeUpperBoundField];
  }
}


- (IBAction) addNameTarget:(id)sender {
  [nameTestControls addTarget];
  [self updateEnabledState: nil];
}

- (IBAction) removeNameTarget:(id)sender {
  [nameTestControls removeTarget];
  [self updateEnabledState: nil];
}

- (IBAction) addPathTarget:(id)sender {
  [pathTestControls addTarget];
  [self updateEnabledState: nil];
}

- (IBAction) removePathTarget:(id)sender {
  [pathTestControls removeTarget];
  [self updateEnabledState: nil];
}

- (IBAction) addTypeTarget:(id)sender {
  [typeTestControls addTarget];
  [self updateEnabledState: nil];
}

- (IBAction) removeTypeTarget:(id)sender {
  [typeTestControls removeTarget];
  [self updateEnabledState: nil];
}


@end // @implementation FilterTestWindowControl


@implementation FilterTestWindowControl (PrivateMethods) 

- (void) resetState {
  testNameField.stringValue = @"";
  [testNameField setEnabled: YES];
  
  // Forget about any previously reported invalid names.
  [invalidName release];
  invalidName = nil;
  
  [testTargetPopUp selectItemAtIndex: POPUP_FILES];

  nameCheckBox.state = NSControlStateValueOff;
  [nameTestControls resetState];
  
  pathCheckBox.state = NSControlStateValueOff;
  [pathTestControls resetState];

  typeCheckBox.state = NSControlStateValueOff;
  [typeTestControls resetState];

  sizeLowerBoundCheckBox.state = NSControlStateValueOff;
  sizeLowerBoundField.intValue = 0;
  [sizeLowerBoundUnits selectItemAtIndex: POPUP_BYTES];
  
  sizeUpperBoundCheckBox.state = NSControlStateValueOff;
  sizeUpperBoundField.intValue = 0;
  [sizeUpperBoundUnits selectItemAtIndex: POPUP_BYTES];
  
  hardLinkCheckBox.state = NSControlStateValueOff;
  [hardLinkStatusPopUp selectItemAtIndex: POPUP_FLAG_IS];

  packageCheckBox.state = NSControlStateValueOff;
  [packageStatusPopUp selectItemAtIndex: POPUP_FLAG_IS];
  
  [self updateWindowTitle];
  [self updateEnabledState: nil];
}


- (void) updateStateBasedOnTest:(FileItemTest *)test {
  if ([test isKindOfClass: [ItemNameTest class]]) {
    [self updateStateBasedOnItemNameTest: (ItemNameTest *)test];
  }
  else if ([test isKindOfClass: [ItemPathTest class]]) {
    [self updateStateBasedOnItemPathTest: (ItemPathTest *)test];
  }
  else if ([test isKindOfClass: [ItemTypeTest class]]) {
    [self updateStateBasedOnItemTypeTest: (ItemTypeTest *)test];
  }
  else if ([test isKindOfClass: [ItemSizeTest class]]) {
    [self updateStateBasedOnItemSizeTest: (ItemSizeTest *)test];
  }
  else if ([test isKindOfClass: [ItemFlagsTest class]]) {
    [self updateStateBasedOnItemFlagsTest: (ItemFlagsTest *)test];
  }

  else {
    NSAssert(NO, @"Unexpected test.");
  }
}


- (void) updateStateBasedOnItemNameTest:(ItemNameTest *)test {
  [nameTestControls updateStateBasedOnStringTest: (MultiMatchStringTest*)test.stringTest];
  nameCheckBox.state = NSControlStateValueOn;
}


- (void) updateStateBasedOnItemPathTest:(ItemPathTest *)test {
  [pathTestControls updateStateBasedOnStringTest: (MultiMatchStringTest*)test.stringTest];
  pathCheckBox.state = NSControlStateValueOn;
}


- (void) updateStateBasedOnItemTypeTest:(ItemTypeTest *)test {
  [typeTestControls updateStateBasedOnItemTypeTest: test];
  typeCheckBox.state = NSControlStateValueOn;
}


- (void) updateStateBasedOnItemSizeTest:(ItemSizeTest *)test {
  int  bytesUnit = FileItem.bytesPerKilobyte;

  if (test.hasLowerBound) {
    item_size_t  bound = test.lowerBound;
    int  i = POPUP_BYTES;
    
    if (bound > 0) {
      while (i < POPUP_GB && (bound % bytesUnit)==0) {
        i++;
        bound /= bytesUnit;
      }
    }
    
    sizeLowerBoundCheckBox.state = NSControlStateValueOn;
    sizeLowerBoundField.integerValue = bound;
    [sizeLowerBoundUnits selectItemAtIndex: i]; 
  }

  if (test.hasUpperBound) {
    item_size_t  bound = test.upperBound;
    int  i = POPUP_BYTES;
          
    if (bound > 0) {
      while (i < POPUP_GB && (bound % bytesUnit)==0) {
        i++;
        bound /= bytesUnit;
      }
    }
    
    sizeUpperBoundCheckBox.state = NSControlStateValueOn;
    sizeUpperBoundField.integerValue = bound;
    [sizeUpperBoundUnits selectItemAtIndex: i];
  }
}


- (void) updateStateBasedOnItemFlagsTest:(ItemFlagsTest *)test {
  if ([test flagsMask] & FileItemIsHardlinked) {
    hardLinkCheckBox.state = NSControlStateValueOn;
    
    [hardLinkStatusPopUp selectItemAtIndex:
      (test.desiredResult & FileItemIsHardlinked) ? POPUP_FLAG_IS : POPUP_FLAG_IS_NOT];
  }
  
  if (test.flagsMask & FileItemIsPackage) {
    packageCheckBox.state = NSControlStateValueOn;
    
    [packageStatusPopUp selectItemAtIndex: 
      (test.desiredResult & FileItemIsPackage) ? POPUP_FLAG_IS : POPUP_FLAG_IS_NOT];
  }
}


- (FileItemTest *)updateStateBasedOnSelectiveItemTest: 
                    (SelectiveItemTest *)test {
  [testTargetPopUp selectItemAtIndex: test.applyToFilesOnly ? POPUP_FILES : POPUP_FOLDERS];
  
  return test.subItemTest;
}


- (ItemNameTest *)itemNameTestBasedOnState {
  if (nameCheckBox.state != NSControlStateValueOn) {
    return nil;
  }
  
  MultiMatchStringTest  *stringTest = nameTestControls.stringTestBasedOnState;
  return ( (stringTest != nil )
           ? [[[ItemNameTest alloc] initWithStringTest: stringTest] autorelease]
           : nil );
}


- (ItemPathTest *)itemPathTestBasedOnState {
  if (pathCheckBox.state != NSControlStateValueOn) {
    return nil;
  }
  
  MultiMatchStringTest  *stringTest = [pathTestControls stringTestBasedOnState];
  
  return ( (stringTest != nil)
           ? [[[ItemPathTest alloc] initWithStringTest: stringTest] autorelease]
           : nil );
}


- (ItemTypeTest *)itemTypeTestBasedOnState {
  return ( (typeCheckBox.state == NSControlStateValueOn)
           ? typeTestControls.itemTypeTestBasedOnState
           : nil );
}


- (ItemSizeTest *)itemSizeTestBasedOnState {
  int  bytesUnit = FileItem.bytesPerKilobyte;

  item_size_t  lowerBound = MAX(0, [sizeLowerBoundField intValue]);
  NSUInteger  i = sizeLowerBoundUnits.indexOfSelectedItem;
  while (i-- > 0) {
    lowerBound *= bytesUnit;
  }

  item_size_t  upperBound = MAX(0, [sizeUpperBoundField intValue]);
  i = sizeUpperBoundUnits.indexOfSelectedItem;
  while (i-- > 0) {
    upperBound *= bytesUnit;
  }
  
  if (sizeLowerBoundCheckBox.state==NSControlStateValueOn && lowerBound>0) {
    if (sizeUpperBoundCheckBox.state==NSControlStateValueOn) {
      return [[[ItemSizeTest alloc] initWithLowerBound: lowerBound upperBound: upperBound]
               autorelease];
    }
    else {
      return [[[ItemSizeTest alloc] initWithLowerBound: lowerBound] autorelease];
    }
  }
  else {
    if (sizeUpperBoundCheckBox.state==NSControlStateValueOn) {
      return [[[ItemSizeTest alloc] initWithUpperBound: upperBound] autorelease];
    }
    else {
      return nil;
    }
  }
}


- (ItemFlagsTest *)itemFlagsTestBasedOnState {
  FileItemOptions  flagsMask = 0;
  FileItemOptions  desiredResult = 0;
  
  if (hardLinkCheckBox.state == NSControlStateValueOn) {
    flagsMask |= FileItemIsHardlinked;
    if (hardLinkStatusPopUp.indexOfSelectedItem == POPUP_FLAG_IS) {
      desiredResult |= FileItemIsHardlinked;
    }
  }
  
  if (packageCheckBox.state == NSControlStateValueOn) {
    flagsMask |= FileItemIsPackage;
    if (packageStatusPopUp.indexOfSelectedItem == POPUP_FLAG_IS) {
      desiredResult |= FileItemIsPackage;
    }
  }
  
  if (flagsMask) {
    return [[[ItemFlagsTest alloc] initWithFlagsMask: flagsMask desiredResult: desiredResult]
            autorelease];
  }
  else {
    return nil;
  }
}


- (FileItemTest *)selectiveItemTestBasedOnState:(FileItemTest *)subTest {
  NSUInteger  index = testTargetPopUp.indexOfSelectedItem;
  
  if (index == POPUP_FILES_AND_FOLDERS) { 
    return subTest;
  }
  else {
    BOOL  onlyFiles = (index == POPUP_FILES);
  
    return [[[SelectiveItemTest alloc] initWithSubItemTest: subTest onlyFiles: onlyFiles]
            autorelease];
  } 
}


- (IBAction) updateEnabledState:(id)sender {
  // Note: "sender" is ignored. Always updating all.
  
  BOOL  targetsOnlyFiles = testTargetPopUp.indexOfSelectedItem == POPUP_FILES;
  
  BOOL  nameTestUsed = nameCheckBox.state==NSControlStateValueOn;
  BOOL  pathTestUsed = pathCheckBox.state==NSControlStateValueOn;
  BOOL  hardLinkTestUsed = hardLinkCheckBox.state==NSControlStateValueOn;
  BOOL  packageTestUsed = packageCheckBox.state==NSControlStateValueOn;
  BOOL  typeTestUsed = ( typeCheckBox.state==NSControlStateValueOn && targetsOnlyFiles );
  BOOL  lowerBoundTestUsed = ( sizeLowerBoundCheckBox.state==NSControlStateValueOn
                               && targetsOnlyFiles );
  BOOL  upperBoundTestUsed = ( sizeUpperBoundCheckBox.state==NSControlStateValueOn
                               && targetsOnlyFiles );
  
  [nameTestControls setEnabled: nameTestUsed];
  [pathTestControls setEnabled: pathTestUsed];

  hardLinkStatusPopUp.enabled = hardLinkTestUsed;
  packageStatusPopUp.enabled = packageTestUsed;
  
  typeCheckBox.enabled = targetsOnlyFiles;
  [typeTestControls setEnabled: typeTestUsed];
  
  sizeLowerBoundCheckBox.enabled = targetsOnlyFiles;
  sizeLowerBoundField.enabled = lowerBoundTestUsed;
  sizeLowerBoundUnits.enabled = lowerBoundTestUsed;

  sizeUpperBoundCheckBox.enabled = targetsOnlyFiles;
  sizeUpperBoundField.enabled = upperBoundTestUsed;
  sizeUpperBoundUnits.enabled = upperBoundTestUsed;

  okButton.enabled = ![self isNameKnownInvalid]
     && ( (nameTestUsed && nameTestControls.hasTargets)
          || (pathTestUsed && pathTestControls.hasTargets)
          || (typeTestUsed && typeTestControls.hasTargets)
          || lowerBoundTestUsed 
          || upperBoundTestUsed 
          || hardLinkTestUsed
          || packageTestUsed);
}


- (void) updateWindowTitle {
  NSString  *name = testNameField.stringValue;
  NSString  *title;
  if (name == nil || name.length==0) {
    title = NSLocalizedString(@"Unnamed filter test", @"Window title");
  }
  else {
    NSString  *format = NSLocalizedString(@"Filter test - %@", @"Window title");
    title = [NSString stringWithFormat: format, name];
  }
  self.window.title = title;
}


- (BOOL) tryStopFieldEditor {
  // Try making the window first responder. If this fails, it means that a field editor is being
  // used that does not want to give up its first responder status because its delegate tells it not
  // to (because its text value is still invalid).
  //
  // The field editor can be made to give up its first responder status by "brute force" using
  // endEditingFor:. However, this then requires extra work to ensure the state is consistent, and
  // does not seem worth the effort.
  return ([self.window makeFirstResponder: self.window]);
}


- (void) textEditingStarted:(NSNotification *)notification {
  NSWindow  *window = self.window;
  BOOL  nameFieldIsFirstResponder =
    ( [window.firstResponder isKindOfClass: [NSTextView class]] &&
      [window fieldEditor: NO forObject: nil] != nil &&
      ((NSTextView *)window.firstResponder).delegate == (id)testNameField );

  if (nameFieldIsFirstResponder) { 
    // Disable Return key equivalent for OK button while editing is in progress. When the field is
    // non-empty, Return should signal the end of the edit session and enable the OK button, but not
    // directly invoke it.
    okButton.keyEquivalent = @"";
  }
}

- (void) textEditingStopped:(NSNotification *)notification {
  // Re-enable the Return key equivalent again. It is done after a short delay as otherwise it will
  // still handle the Return key press that may have triggered this event.
  [okButton performSelector: @selector(setKeyEquivalent:)
                 withObject: @"\r" afterDelay: 0.1
                    inModes: @[NSModalPanelRunLoopMode, NSDefaultRunLoopMode]];
}


- (BOOL) isNameKnownInvalid {
  NSString  *currentName = testNameField.stringValue;
  return currentName.length == 0 || [currentName isEqualToString: invalidName];
}

@end // @implementation FilterTestWindowControl (PrivateMethods)


@implementation MultiMatchControls

- (instancetype) initWithMatchModePopUpButton:(NSPopUpButton *)popUpButton
                                  targetsView:(NSTableView *)targetsTableViewVal
                              addTargetButton:(NSButton *)addButton
                           removeTargetButton:(NSButton *)removeButton {
  if (self = [super init]) {
    matchPopUpButton = [popUpButton retain];
    targetsView = [targetsTableViewVal retain];
    addTargetButton = [addButton retain];
    removeTargetButton = [removeButton retain];
    
    matchTargets = [[NSMutableArray alloc] initWithCapacity: 4];
    
    targetsView.dataSource = self;
    targetsView.delegate = self;
  }
  
  return self;
}


- (void) dealloc {
  [matchPopUpButton release];
  [targetsView release];
  [addTargetButton release];
  [removeTargetButton release];
  
  [matchTargets release];

  [super dealloc];
}


- (void) resetState {
  [matchPopUpButton selectItemAtIndex: 0];
  
  [matchTargets removeAllObjects];
  [targetsView reloadData];
}


- (void) setEnabled:(BOOL) enabledVal {
  enabled = enabledVal;
  
  [self updateEnabledState];
}


- (BOOL) hasTargets {
  return matchTargets.count > 0;
}

- (void) addTarget {
  NSAssert(NO, @"Abstract method");
}

- (void) removeTarget {
  NSInteger  selectedRow = targetsView.selectedRow;

  NSAssert(selectedRow >= 0, @"No row selected");
  [matchTargets removeObjectAtIndex: selectedRow];

  if (selectedRow == matchTargets.count && selectedRow > 0) {
    [targetsView selectRowIndexes: [NSIndexSet indexSetWithIndex: selectedRow - 1] 
             byExtendingSelection: NO];
  }

  [targetsView reloadData];
}


//----------------------------------------------------------------------------
// Delegate methods for NSTable

- (void) tableViewSelectionDidChange:(NSNotification *)notification {
  [self updateEnabledState];
}


//----------------------------------------------------------------------------
// NSTableSource

- (NSInteger) numberOfRowsInTableView:(NSTableView *)tableView {
  return matchTargets.count;
}

- (id) tableView:(NSTableView *)tableView objectValueForTableColumn:(NSTableColumn *)column
             row:(NSInteger)row {
  return matchTargets[row];
}

@end // @implementation MultiMatchControls


@implementation MultiMatchControls (PrivateMethods)

- (void) updateEnabledState {
  matchPopUpButton.enabled = enabled;
  targetsView.enabled = enabled;
  addTargetButton.enabled = enabled;
  removeTargetButton.enabled = (enabled && targetsView.numberOfSelectedRows > 0);
}

@end // @implementation MultiMatchControls (PrivateMethods)


@implementation StringMatchControls

// Overrides designated initialiser
- (instancetype) initWithMatchModePopUpButton:(NSPopUpButton *)popUpButton
                                  targetsView:(NSTableView *)targetsTableViewVal
                              addTargetButton:(NSButton *)addButton
                           removeTargetButton:(NSButton *)removeButton {
  NSAssert(NO, @"Use other initialiser.");
  return [self initWithMatchModePopUpButton: nil targetsView: nil addTargetButton: nil
                         removeTargetButton: nil];
}

- (instancetype) initWithMatchModePopUpButton:(NSPopUpButton *)popUpButton
                                  targetsView:(NSTableView *)targetsTableViewVal
                      caseInsensitiveCheckBox:(NSButton *)caseCheckBox
                              addTargetButton:(NSButton *)addButton
                           removeTargetButton:(NSButton *)removeButton
                                windowControl:(FilterTestWindowControl *)windowControlVal {
  if (self = [super initWithMatchModePopUpButton: popUpButton
                                     targetsView: targetsTableViewVal
                                 addTargetButton: addButton
                              removeTargetButton: removeButton]) {
    caseInsensitiveCheckBox = [caseCheckBox retain];
    windowControl = [windowControlVal retain];
    
    editInProgress = NO;
    
    NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;

    [nc addObserver: self
           selector: @selector(didBeginEditing:)
               name: NSControlTextDidBeginEditingNotification
             object: targetsView];
    [nc addObserver: self
           selector: @selector(didEndEditing:)
               name: NSControlTextDidEndEditingNotification
             object: targetsView];
  }
  
  return self;
}


- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];

  [caseInsensitiveCheckBox release];
  [windowControl release];

  [super dealloc];
}


- (void) resetState {
  [super resetState];
  
  [matchPopUpButton selectItemAtIndex: POPUP_STRING_IS];
  caseInsensitiveCheckBox.state = NSControlStateValueOff;
}


- (void) addTarget {
  NSAssert(!editInProgress, @"Cannot add target while edit in progress.");

  if (![windowControl tryStopFieldEditor]) {
    // Another field editor is already active and does not want to resign first responder status.
    return;
  }

  NSUInteger  newRow = matchTargets.count;
  
  [matchTargets addObject: NSLocalizedString(@"New match",
                                             @"Initial match value in FilterTestWindow")];
  [targetsView reloadData];
  [targetsView selectRowIndexes: [NSIndexSet indexSetWithIndex: newRow] byExtendingSelection: NO];
  
  editInProgress = YES;
  [self updateEnabledState];
  
  [targetsView editColumn: 0 row: newRow withEvent: nil select: YES];
}

- (void) removeTarget {
  NSAssert(!editInProgress, @"Cannot remove target while edit in progress.");
  
  [super removeTarget];
}


- (void) updateStateBasedOnStringTest:(MultiMatchStringTest *)test {
  int  index = -1;
    
  if ([test isKindOfClass: [StringEqualityTest class]]) {
    index = POPUP_STRING_IS;
  }
  else if ([test isKindOfClass: [StringContainmentTest class]]) {
    index = POPUP_STRING_CONTAINS;
  }
  else if ([test isKindOfClass: [StringPrefixTest class]]) {
    index = POPUP_STRING_STARTS_WITH;
  }
  else if ([test isKindOfClass: [StringSuffixTest class]]) {
    index = POPUP_STRING_ENDS_WITH;
  }
  else {
    NSAssert(NO, @"Unknown string test.");
  }
  [matchPopUpButton selectItemAtIndex: index];
  
  [matchTargets removeAllObjects];
  [matchTargets addObjectsFromArray: test.matchTargets];
  [targetsView reloadData];
  
  caseInsensitiveCheckBox.state =
    test.isCaseSensitive ? NSControlStateValueOff : NSControlStateValueOn;
}


- (MultiMatchStringTest *)stringTestBasedOnState {
  if (!self.hasTargets) {
    return nil;
  }
  
  MultiMatchStringTest  *stringTest = nil;
  switch (matchPopUpButton.indexOfSelectedItem) {
    case POPUP_STRING_IS: 
      stringTest = [StringEqualityTest alloc]; 
      break;
    case POPUP_STRING_CONTAINS: 
      stringTest = [StringContainmentTest alloc]; 
      break;
    case POPUP_STRING_STARTS_WITH: 
      stringTest = [StringPrefixTest alloc]; 
      break;
    case POPUP_STRING_ENDS_WITH: 
      stringTest = [StringSuffixTest alloc]; 
      break;
    default: NSAssert(NO, @"Unexpected matching index.");
  }
      
  BOOL  caseSensitive = (caseInsensitiveCheckBox.state == NSControlStateValueOff);
  stringTest = [[stringTest initWithMatchTargets: matchTargets
                                   caseSensitive: caseSensitive] autorelease];
      
  return stringTest;
}


//----------------------------------------------------------------------------
// Delegate methods for NSTable

- (BOOL) control:(NSControl *)control textShouldEndEditing:(NSText *)editor {
  return editor.string.length > 0;
}


//----------------------------------------------------------------------------
// NSTableSource

- (void) tableView:(NSTableView *)tableView
    setObjectValue:(id)object
    forTableColumn:(NSTableColumn *)column
               row:(NSInteger)row {
  matchTargets[row] = object;
}

- (BOOL) tableView:(NSTableView *)tableView shouldEditTableColumn:(NSTableColumn *)column
               row:(NSInteger)row {
  if (!tableView.enabled || ![windowControl tryStopFieldEditor]) {
    return NO;
  }
           
  // Switch to "edit in progress" mode immediately. If not done here, the notification is only sent
  // when the first change is made to the text. However, we like to disable the Remove button as
  // soon as the field editor is active. Otherwise, removal will first remove the cell, then stop
  // the field editor, which overwrites the old value over what has become a different target
  // alltogether.
  [self didBeginEditing: nil];

  return YES;
}


@end // implementation StringMatchControls


@implementation StringMatchControls (PrivateMethods)

- (void) updateEnabledState {
  [super updateEnabledState];
  
  caseInsensitiveCheckBox.enabled = enabled;
  
  if (editInProgress) {
    [addTargetButton setEnabled: NO];
    [removeTargetButton setEnabled: NO];
  }
}


- (void) didBeginEditing:(NSNotification *)notification {
  editInProgress = YES;
  
  [self updateEnabledState];
}

- (void) didEndEditing:(NSNotification *)notification {
  editInProgress = NO;

  [self updateEnabledState];
}

@end // @implementation StringMatchControls (PrivateMethods)


@implementation TypeMatchControls

- (instancetype) initWithMatchModePopUpButton:(NSPopUpButton *)popUpButton
                                  targetsView:(NSTableView *)targetsTableViewVal
                              addTargetButton:(NSButton *)addButton
                           removeTargetButton:(NSButton *)removeButton {
  if (self = [super initWithMatchModePopUpButton: popUpButton
                                     targetsView: targetsTableViewVal
                                 addTargetButton: addButton
                              removeTargetButton: removeButton]) {

    // Add all known UniformTypes to the "Add target" popup button
    UniformTypeInventory  *typeInventory = UniformTypeInventory.defaultUniformTypeInventory;

    NSMutableArray  *unsortedTypes = [NSMutableArray arrayWithCapacity: typeInventory.count];
    for (UniformType *type in [typeInventory uniformTypeEnumerator]) {
      [unsortedTypes addObject: type.uniformTypeIdentifier];
    }
    
    NSArray  *sortedTypes = [unsortedTypes sortedArrayUsingSelector: @selector(compare:)];
    [((NSPopUpButton *)addButton) addItemsWithTitles: sortedTypes];
  }
  
  return self;
}


- (void) resetState {
  [super resetState];

  [matchPopUpButton selectItemAtIndex: POPUP_TYPE_CONFORMS_TO];
  [((NSPopUpButton *)addTargetButton) selectItemAtIndex: POPUP_ADD_TYPE];
}


- (void) addTarget {
  NSPopUpButton  *popUp = (NSPopUpButton *)addTargetButton;
  NSInteger  selectedIndex = popUp.indexOfSelectedItem;
  if (selectedIndex <= 0) {
    return;
  }

  UniformTypeInventory  *typeInventory = UniformTypeInventory.defaultUniformTypeInventory;

  UniformType  *type = [typeInventory uniformTypeForIdentifier: popUp.titleOfSelectedItem];
  // Restore popup state
  [popUp selectItemAtIndex: POPUP_ADD_TYPE];

  NSUInteger  newRow = matchTargets.count;

  [matchTargets addObject: type];
  [targetsView reloadData];
  [targetsView selectRowIndexes: [NSIndexSet indexSetWithIndex: newRow]
           byExtendingSelection: NO];
  
  [self updateEnabledState];
}


- (void) updateStateBasedOnItemTypeTest:(ItemTypeTest *)test {
  [matchPopUpButton selectItemAtIndex: test.isStrict ? POPUP_TYPE_EQUALS : POPUP_TYPE_CONFORMS_TO];
  
  [matchTargets removeAllObjects];
  [matchTargets addObjectsFromArray: test.matchTargets];
  [targetsView reloadData];
}

- (ItemTypeTest *)itemTypeTestBasedOnState {
  if (!self.hasTargets) {
    return nil;
  }
  
  BOOL  isStrict = matchPopUpButton.indexOfSelectedItem == POPUP_TYPE_EQUALS;

  return [[[ItemTypeTest alloc] initWithMatchTargets: matchTargets
                                              strict: isStrict] autorelease];
}


//----------------------------------------------------------------------------
// NSTableSource

- (id) tableView:(NSTableView *)tableView objectValueForTableColumn:(NSTableColumn *)column
             row:(NSInteger)row {
  return [matchTargets[row] uniformTypeIdentifier];
}

@end // @implementation TypeMatchControls
